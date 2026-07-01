import { randomBytes } from 'node:crypto';
import { GatewayError, SignatureError, ValidationError } from '../../core/errors.js';
import { HttpClient } from '../../core/http.js';
import { assertInitInput, assertRefundInput, formatAmount } from '../../core/validate.js';
import { PaymentStatus } from '../../types/status.js';
import type { PaymentMode } from '../../types/status.js';
import type { NagadCredentials } from '../../types/config.js';
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
import { decrypt, encrypt, sign, verify } from './crypto.js';
import type {
  NagadInitDecrypted,
  NagadRefundResponse,
  NagadSecureEnvelope,
  NagadVerifyResponse,
} from './types.js';

const BASE_URLS: Record<PaymentMode, string> = {
  sandbox: 'http://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs',
  live: 'https://api.mynagad.com/api/dfs',
};

const API_VERSION = 'v-0.2.0';
const CLIENT_TYPE = 'PC_WEB';
/** ISO-4217 numeric code for BDT. */
const CURRENCY_CODE = '050';

/** Map Nagad status strings onto the normalized enum. */
export function normalizeNagadStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'success':
    case 'completed':
      return PaymentStatus.SUCCESS;
    case 'pending':
    case 'in_progress':
    case 'initiated':
      return PaymentStatus.PENDING;
    case 'aborted':
    case 'cancelled':
    case 'canceled':
      return PaymentStatus.CANCELLED;
    case 'refunded':
      return PaymentStatus.REFUNDED;
    case 'partially_refunded':
      return PaymentStatus.PARTIALLY_REFUNDED;
    case 'failed':
    case 'unknown':
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.PENDING;
  }
}

export interface NagadOptions {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** IPv4 sent in the X-KM-IP-V4 header (Nagad requires a value). */
  clientIp?: string;
}

export class NagadGateway implements IPaymentGateway {
  private readonly http: HttpClient;
  private readonly baseURL: string;
  private readonly merchantId: string;
  private readonly merchantPrivateKey: string;
  private readonly pgPublicKey: string;
  private readonly clientIp: string;

  constructor(credentials: NagadCredentials, mode: PaymentMode, options: NagadOptions = {}) {
    if (!credentials.merchantId || !credentials.merchantPrivateKey || !credentials.pgPublicKey) {
      throw new ValidationError(
        'Nagad requires merchantId, merchantPrivateKey and pgPublicKey',
        { gateway: 'nagad' },
      );
    }
    this.merchantId = credentials.merchantId;
    this.merchantPrivateKey = credentials.merchantPrivateKey;
    this.pgPublicKey = credentials.pgPublicKey;
    this.clientIp = options.clientIp ?? '0.0.0.0';
    this.baseURL = BASE_URLS[mode];
    this.http = new HttpClient({
      gateway: 'nagad',
      defaultTimeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-KM-Api-Version': API_VERSION,
      'X-KM-IP-V4': this.clientIp,
      'X-KM-Client-Type': CLIENT_TYPE,
    };
  }

  /**
   * Full Nagad checkout handshake, all server-side:
   *   1. initialize -> get an encrypted paymentReferenceId + Nagad challenge
   *   2. complete   -> submit amount, receive the customer redirect URL
   */
  async initPayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    assertInitInput(input, 'nagad');
    const dateTime = nagadDateTime();
    const challenge = randomBytes(16).toString('hex');

    // --- Step 1: initialize ---
    const initPlain = JSON.stringify({
      merchantId: this.merchantId,
      datetime: dateTime,
      orderId: input.orderId,
      challenge,
    });
    const initEnvelope: NagadSecureEnvelope = {
      accountNumber: input.customer?.phone ?? '',
      dateTime,
      sensitiveData: encrypt(initPlain, this.pgPublicKey),
      signature: sign(initPlain, this.merchantPrivateKey),
    };

    const initRes = await this.http.request<NagadSecureEnvelope>({
      method: 'POST',
      url: `${this.baseURL}/check-out/initialize/${this.merchantId}/${encodeURIComponent(input.orderId)}`,
      headers: this.headers(),
      body: initEnvelope,
    });

    const initDecoded = this.decodeEnvelope<NagadInitDecrypted>(initRes.data, 'initialize');
    const { paymentReferenceId, challenge: nagadChallenge } = initDecoded;
    if (!paymentReferenceId || !nagadChallenge) {
      throw new GatewayError('Nagad initialize did not return a payment reference', {
        gateway: 'nagad',
        raw: initRes.data,
      });
    }

    // --- Step 2: complete ---
    const completePlain = JSON.stringify({
      merchantId: this.merchantId,
      orderId: input.orderId,
      currencyCode: CURRENCY_CODE,
      amount: formatAmount(input.amount),
      challenge: nagadChallenge,
    });
    const completeBody = {
      sensitiveData: encrypt(completePlain, this.pgPublicKey),
      signature: sign(completePlain, this.merchantPrivateKey),
      merchantCallbackURL: input.callbackURL,
      additionalMerchantInfo: input.metadata ?? {},
    };

    const completeRes = await this.http.request<NagadSecureEnvelope & { callBackUrl?: string; status?: string; message?: string }>(
      {
        method: 'POST',
        url: `${this.baseURL}/check-out/complete/${encodeURIComponent(paymentReferenceId)}`,
        headers: this.headers(),
        body: completeBody,
      },
    );

    const redirectURL = completeRes.data.callBackUrl;
    if (!redirectURL) {
      throw new GatewayError(completeRes.data.message ?? 'Nagad complete did not return a redirect URL', {
        gateway: 'nagad',
        providerCode: completeRes.data.status,
        raw: completeRes.data,
      });
    }

    return {
      redirectURL,
      paymentRef: paymentReferenceId,
      raw: { initialize: initRes.data, complete: completeRes.data },
    };
  }

  async executePayment(input: ExecutePaymentInput): Promise<StatusResult> {
    return this.queryPayment({ paymentRef: input.paymentRef });
  }

  async queryPayment(input: QueryPaymentInput): Promise<StatusResult> {
    const res = await this.http.request<NagadVerifyResponse>({
      method: 'GET',
      url: `${this.baseURL}/verify/payment/${encodeURIComponent(input.paymentRef)}`,
      headers: this.headers(),
    });
    const d = res.data;
    return {
      status: normalizeNagadStatus(d.status),
      paymentRef: input.paymentRef,
      orderId: d.orderId,
      transactionId: d.issuerPaymentRefNo,
      amount: d.amount ? Number(d.amount) : undefined,
      currency: 'BDT',
      providerStatus: d.status,
      raw: d,
    };
  }

  /**
   * Refund via Nagad's secure-envelope pattern. Refund availability depends on
   * the merchant agreement; on unsupported accounts Nagad returns a non-success
   * status, surfaced here as a {@link GatewayError}.
   */
  async refund(input: RefundInput): Promise<RefundResult> {
    assertRefundInput(input, 'nagad');
    const status = await this.queryPayment({ paymentRef: input.paymentRef });
    const orderId = status.orderId ?? input.paymentRef;
    const refundPlain = JSON.stringify({
      merchantId: this.merchantId,
      paymentRefId: input.paymentRef,
      orderId,
      amount: input.amount !== undefined ? formatAmount(input.amount) : status.amount,
      currencyCode: CURRENCY_CODE,
      referenceNo: input.transactionId ?? status.transactionId ?? '',
      reason: input.reason ?? 'refund',
    });
    const body = {
      sensitiveData: encrypt(refundPlain, this.pgPublicKey),
      signature: sign(refundPlain, this.merchantPrivateKey),
    };

    const res = await this.http.request<NagadRefundResponse>({
      method: 'POST',
      url: `${this.baseURL}/purchase/refund/${encodeURIComponent(input.paymentRef)}`,
      headers: this.headers(),
      body,
    });
    const ok = (res.data.status ?? '').toLowerCase() === 'success';
    if (!ok) {
      throw new GatewayError(res.data.message ?? 'Nagad refund was not successful', {
        gateway: 'nagad',
        providerCode: res.data.status,
        raw: res.data,
      });
    }
    return {
      status: PaymentStatus.REFUNDED,
      refundRef: res.data.refundRefId,
      paymentRef: input.paymentRef,
      raw: res.data,
    };
  }

  /**
   * Nagad redirects the customer to `merchantCallbackURL?payment_ref_id=..&status=..`.
   * The callback is unsigned, so we re-query Nagad for the authoritative status.
   */
  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    const paymentRefId =
      input.payload['payment_ref_id'] ?? input.payload['paymentRefId'] ?? input.payload['payment_ref'];
    const callbackStatus = (input.payload['status'] ?? '').toLowerCase();
    if (!paymentRefId) {
      return { verified: false, status: PaymentStatus.FAILED, raw: input.payload };
    }
    if (callbackStatus === 'aborted' || callbackStatus === 'cancelled') {
      return {
        verified: true,
        status: PaymentStatus.CANCELLED,
        paymentRef: paymentRefId,
        raw: input.payload,
      };
    }
    const status = await this.queryPayment({ paymentRef: paymentRefId });
    return {
      verified: true,
      status: status.status,
      paymentRef: paymentRefId,
      orderId: status.orderId,
      transactionId: status.transactionId,
      raw: { callback: input.payload, query: status.raw },
    };
  }

  /**
   * Decrypt an inbound Nagad envelope with the merchant private key and verify
   * its signature against the PG public key. Exposed conceptually for the init
   * step; throws {@link SignatureError} when verification fails.
   */
  private decodeEnvelope<T>(envelope: NagadSecureEnvelope, phase: string): T {
    if (!envelope.sensitiveData) {
      throw new GatewayError(`Nagad ${phase} returned no sensitiveData`, {
        gateway: 'nagad',
        raw: envelope,
      });
    }
    const plaintext = decrypt(envelope.sensitiveData, this.merchantPrivateKey);
    if (envelope.signature && !verify(plaintext, envelope.signature, this.pgPublicKey)) {
      throw new SignatureError(`Nagad ${phase} response signature invalid`, {
        gateway: 'nagad',
        raw: envelope,
      });
    }
    return JSON.parse(plaintext) as T;
  }
}

/** Nagad expects `YYYYMMDDHHmmss` in Asia/Dhaka (GMT+6). */
export function nagadDateTime(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
}
