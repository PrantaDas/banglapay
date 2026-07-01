import { createHash } from 'node:crypto';
import { GatewayError, ValidationError } from '../../core/errors.js';
import { HttpClient } from '../../core/http.js';
import { assertInitInput, assertRefundInput, formatAmount } from '../../core/validate.js';
import { PaymentStatus } from '../../types/status.js';
import type { PaymentMode } from '../../types/status.js';
import type { SSLCommerzCredentials } from '../../types/config.js';
import type { IPaymentGateway } from '../../types/gateway.js';
import type {
  ExecutePaymentInput,
  InitPaymentInput,
  InitPaymentResult,
  QueryPaymentInput,
  RefundInput,
  RefundResult,
  StatusResult,
  WebhookResult,
  WebhookVerifyInput,
} from '../../types/results.js';
import type {
  SSLCommerzRefundResponse,
  SSLCommerzSessionResponse,
  SSLCommerzTransactionQueryResponse,
  SSLCommerzValidationResponse,
} from './types.js';

const BASE_URLS: Record<PaymentMode, string> = {
  sandbox: 'https://sandbox.sslcommerz.com',
  live: 'https://securepay.sslcommerz.com',
};

/** Map SSLCOMMERZ status strings onto the normalized enum. */
export function normalizeSSLStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'VALID':
    case 'VALIDATED':
    case 'SUCCESS':
      return PaymentStatus.SUCCESS;
    case 'PENDING':
    case 'PROCESSING':
      return PaymentStatus.PENDING;
    case 'CANCELLED':
    case 'CANCEL':
      return PaymentStatus.CANCELLED;
    case 'REFUNDED':
      return PaymentStatus.REFUNDED;
    case 'INVALID_TRANSACTION':
    case 'FAILED':
    case 'UNATTEMPTED':
    case 'EXPIRED':
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.PENDING;
  }
}

export class SSLCommerzGateway implements IPaymentGateway {
  private readonly http: HttpClient;
  private readonly baseURL: string;
  private readonly storeId: string;
  private readonly storePassword: string;

  constructor(
    credentials: SSLCommerzCredentials,
    mode: PaymentMode,
    options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {
    if (!credentials.storeId || !credentials.storePassword) {
      throw new ValidationError('SSLCOMMERZ requires storeId and storePassword', {
        gateway: 'sslcommerz',
      });
    }
    this.storeId = credentials.storeId;
    this.storePassword = credentials.storePassword;
    this.baseURL = BASE_URLS[mode];
    this.http = new HttpClient({
      gateway: 'sslcommerz',
      defaultTimeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  async initPayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    assertInitInput(input, 'sslcommerz');
    const c = input.customer ?? {};
    const body: Record<string, string> = {
      store_id: this.storeId,
      store_passwd: this.storePassword,
      total_amount: formatAmount(input.amount),
      currency: input.currency,
      tran_id: input.orderId,
      success_url: input.callbackURL,
      fail_url: input.callbackURL,
      cancel_url: input.callbackURL,
      ipn_url: input.callbackURL,
      product_name: input.productName ?? `Order ${input.orderId}`,
      product_category: 'general',
      product_profile: 'general',
      shipping_method: 'NO',
      num_of_item: '1',
      cus_name: c.name ?? 'N/A',
      cus_email: c.email ?? 'noreply@example.com',
      cus_phone: c.phone ?? 'N/A',
      cus_add1: c.address ?? 'N/A',
      cus_city: c.city ?? 'Dhaka',
      cus_country: c.country ?? 'Bangladesh',
    };
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      // SSLCOMMERZ echoes value_a..value_d back on the callback/IPN.
      body[k] = v;
    }

    const res = await this.http.request<SSLCommerzSessionResponse>({
      method: 'POST',
      url: `${this.baseURL}/gwprocess/v4/api.php`,
      body,
      bodyType: 'form',
    });

    const data = res.data;
    if (data.status !== 'SUCCESS' || !data.GatewayPageURL) {
      throw new GatewayError(data.failedreason ?? 'SSLCOMMERZ session init failed', {
        gateway: 'sslcommerz',
        providerCode: data.status,
        httpStatus: res.status,
        raw: data,
      });
    }

    return {
      redirectURL: data.GatewayPageURL,
      paymentRef: input.orderId,
      raw: data,
    };
  }

  /**
   * SSLCOMMERZ has no separate capture step: settlement happens on the hosted
   * page. `executePayment` resolves the authoritative status by querying the
   * transaction by its tran_id (the paymentRef).
   */
  async executePayment(input: ExecutePaymentInput): Promise<StatusResult> {
    return this.queryPayment({ paymentRef: input.paymentRef });
  }

  async queryPayment(input: QueryPaymentInput): Promise<StatusResult> {
    const url = new URL(`${this.baseURL}/validator/api/merchantTransIDvalidationAPI.php`);
    url.searchParams.set('tran_id', input.paymentRef);
    url.searchParams.set('store_id', this.storeId);
    url.searchParams.set('store_passwd', this.storePassword);
    url.searchParams.set('format', 'json');

    const res = await this.http.request<SSLCommerzTransactionQueryResponse>({
      method: 'GET',
      url: url.toString(),
    });

    const element = res.data.element?.[0];
    return {
      status: normalizeSSLStatus(element?.status),
      paymentRef: input.paymentRef,
      orderId: element?.tran_id ?? input.paymentRef,
      transactionId: element?.bank_tran_id,
      amount: element?.amount ? Number(element.amount) : undefined,
      currency: 'BDT',
      providerStatus: element?.status,
      raw: res.data,
    };
  }

  /**
   * Validate an order against the validator API using a val_id (obtained from
   * the success callback / IPN). Returns normalized status.
   */
  async validateByValId(valId: string): Promise<StatusResult> {
    const url = new URL(`${this.baseURL}/validator/api/validationserverAPI.php`);
    url.searchParams.set('val_id', valId);
    url.searchParams.set('store_id', this.storeId);
    url.searchParams.set('store_passwd', this.storePassword);
    url.searchParams.set('format', 'json');

    const res = await this.http.request<SSLCommerzValidationResponse>({
      method: 'GET',
      url: url.toString(),
    });
    const d = res.data;
    return {
      status: normalizeSSLStatus(d.status),
      paymentRef: d.tran_id ?? valId,
      orderId: d.tran_id,
      transactionId: d.bank_tran_id,
      amount: d.amount ? Number(d.amount) : undefined,
      currency: 'BDT',
      providerStatus: d.status,
      raw: d,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    assertRefundInput(input, 'sslcommerz');
    // A refund needs the bank_tran_id. Prefer the caller-supplied transactionId,
    // else resolve it by querying the transaction.
    let bankTranId = input.transactionId;
    if (!bankTranId) {
      const status = await this.queryPayment({ paymentRef: input.paymentRef });
      bankTranId = status.transactionId;
    }
    if (!bankTranId) {
      throw new ValidationError(
        'Could not resolve bank_tran_id for refund; pass transactionId explicitly',
        { gateway: 'sslcommerz', raw: input },
      );
    }
    if (input.amount === undefined) {
      throw new ValidationError('SSLCOMMERZ refund requires an explicit amount', {
        gateway: 'sslcommerz',
      });
    }

    const url = new URL(`${this.baseURL}/validator/api/merchantTransIDvalidationAPI.php`);
    url.searchParams.set('bank_tran_id', bankTranId);
    url.searchParams.set('store_id', this.storeId);
    url.searchParams.set('store_passwd', this.storePassword);
    url.searchParams.set('refund_amount', formatAmount(input.amount));
    url.searchParams.set('refund_remarks', input.reason ?? 'Refund');
    url.searchParams.set('format', 'json');

    const res = await this.http.request<SSLCommerzRefundResponse>({
      method: 'GET',
      url: url.toString(),
    });
    const d = res.data;
    const ok = (d.status ?? '').toLowerCase() === 'success';
    return {
      status: ok ? PaymentStatus.REFUNDED : PaymentStatus.FAILED,
      refundRef: d.refund_ref_id,
      paymentRef: input.paymentRef,
      raw: d,
    };
  }

  /** Query the status of a previously initiated refund by its refund_ref_id. */
  async queryRefund(refundRefId: string): Promise<RefundResult> {
    const url = new URL(`${this.baseURL}/validator/api/merchantTransIDvalidationAPI.php`);
    url.searchParams.set('refund_ref_id', refundRefId);
    url.searchParams.set('store_id', this.storeId);
    url.searchParams.set('store_passwd', this.storePassword);
    url.searchParams.set('format', 'json');

    const res = await this.http.request<SSLCommerzRefundResponse>({
      method: 'GET',
      url: url.toString(),
    });
    const d = res.data;
    const s = (d.status ?? '').toLowerCase();
    return {
      status:
        s === 'refunded' || s === 'success'
          ? PaymentStatus.REFUNDED
          : s === 'processing'
            ? PaymentStatus.PENDING
            : PaymentStatus.FAILED,
      refundRef: refundRefId,
      paymentRef: d.trans_id ?? refundRefId,
      raw: d,
    };
  }

  /**
   * Verify an IPN payload using SSLCOMMERZ's hash scheme:
   * concat the fields listed in `verify_key` plus md5(store_passwd), sort by
   * key, build a query string, md5 it, and compare against `verify_sign`.
   */
  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    const p = input.payload;
    const verified = this.verifyIpnHash(p);
    return {
      verified,
      status: normalizeSSLStatus(p['status']),
      paymentRef: p['tran_id'],
      orderId: p['tran_id'],
      transactionId: p['bank_tran_id'],
      raw: p,
    };
  }

  /** Pure IPN hash check, exposed for unit testing. */
  verifyIpnHash(payload: Record<string, string>): boolean {
    const verifySign = payload['verify_sign'];
    const verifyKey = payload['verify_key'];
    if (!verifySign || !verifyKey) return false;

    const fields = verifyKey.split(',').filter((f) => f.length > 0);
    const pairs: Record<string, string> = {};
    for (const field of fields) {
      pairs[field] = payload[field] ?? '';
    }
    pairs['store_passwd'] = createHash('md5').update(this.storePassword).digest('hex');

    const sortedKeys = Object.keys(pairs).sort();
    const queryString = sortedKeys
      .map((k) => `${k}=${pairs[k]}`)
      .join('&');
    const computed = createHash('md5').update(queryString).digest('hex');
    return timingSafeEqualHex(computed, verifySign);
  }
}

/** Constant-time compare of two hex strings of equal length. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
