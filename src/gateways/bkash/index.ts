import { AuthError, GatewayError, ValidationError } from '../../core/errors.js';
import { HttpClient } from '../../core/http.js';
import { assertInitInput, assertRefundInput, formatAmount } from '../../core/validate.js';
import { PaymentStatus } from '../../types/status.js';
import type { PaymentMode } from '../../types/status.js';
import type { BkashCredentials } from '../../types/config.js';
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
import { BkashTokenManager } from './token.js';
import type {
  BkashCreateResponse,
  BkashExecuteResponse,
  BkashRefundResponse,
} from './types.js';

const BASE_URLS: Record<PaymentMode, string> = {
  sandbox: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta',
  live: 'https://tokenized.pay.bka.sh/v1.2.0-beta',
};

/** Map bKash `transactionStatus` onto the normalized enum. */
export function normalizeBkashStatus(status: string | undefined): PaymentStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
      return PaymentStatus.SUCCESS;
    case 'initiated':
    case 'pending':
      return PaymentStatus.PENDING;
    case 'cancelled':
    case 'canceled':
      return PaymentStatus.CANCELLED;
    case 'failed':
      return PaymentStatus.FAILED;
    default:
      return PaymentStatus.PENDING;
  }
}

export class BkashGateway implements IPaymentGateway {
  private readonly http: HttpClient;
  private readonly baseURL: string;
  private readonly appKey: string;
  private readonly tokens: BkashTokenManager;

  constructor(
    credentials: BkashCredentials,
    mode: PaymentMode,
    options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {
    if (
      !credentials.appKey ||
      !credentials.appSecret ||
      !credentials.username ||
      !credentials.password
    ) {
      throw new ValidationError(
        'bKash requires appKey, appSecret, username and password',
        { gateway: 'bkash' },
      );
    }
    this.appKey = credentials.appKey;
    this.baseURL = BASE_URLS[mode];
    this.http = new HttpClient({
      gateway: 'bkash',
      defaultTimeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    this.tokens = new BkashTokenManager(this.http, this.baseURL, credentials);
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.tokens.getToken();
    return {
      Authorization: token,
      'X-APP-Key': this.appKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** POST a JSON body with auth headers; retry once on an auth failure. */
  private async authedPost<T>(path: string, body: unknown): Promise<{ data: T; status: number }> {
    let headers = await this.authHeaders();
    let res = await this.http.request<T & { statusCode?: string }>({
      method: 'POST',
      url: `${this.baseURL}${path}`,
      headers,
      body,
    });
    if (isAuthFailure(res.status, res.data)) {
      // Token may have been revoked early: force a fresh grant and retry once.
      await this.tokens.forceGrant();
      headers = await this.authHeaders();
      res = await this.http.request<T & { statusCode?: string }>({
        method: 'POST',
        url: `${this.baseURL}${path}`,
        headers,
        body,
      });
      if (isAuthFailure(res.status, res.data)) {
        throw new AuthError('bKash authentication failed', {
          gateway: 'bkash',
          httpStatus: res.status,
          raw: res.data,
        });
      }
    }
    return { data: res.data, status: res.status };
  }

  async initPayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    assertInitInput(input, 'bkash');
    const { data } = await this.authedPost<BkashCreateResponse>('/tokenized/checkout/create', {
      mode: '0011',
      payerReference: input.customer?.phone ?? input.orderId,
      callbackURL: input.callbackURL,
      amount: formatAmount(input.amount),
      currency: input.currency,
      intent: 'sale',
      merchantInvoiceNumber: input.orderId,
    });

    if (!data.paymentID || !data.bkashURL) {
      throw new GatewayError(data.statusMessage ?? 'bKash create-payment failed', {
        gateway: 'bkash',
        providerCode: data.statusCode,
        raw: data,
      });
    }

    return {
      redirectURL: data.bkashURL,
      paymentRef: data.paymentID,
      raw: data,
    };
  }

  async executePayment(input: ExecutePaymentInput): Promise<StatusResult> {
    const { data } = await this.authedPost<BkashExecuteResponse>('/tokenized/checkout/execute', {
      paymentID: input.paymentRef,
    });
    if (data.statusCode && data.statusCode !== '0000' && !data.trxID) {
      throw new GatewayError(data.statusMessage ?? 'bKash execute-payment failed', {
        gateway: 'bkash',
        providerCode: data.statusCode,
        raw: data,
      });
    }
    return this.toStatus(input.paymentRef, data);
  }

  async queryPayment(input: QueryPaymentInput): Promise<StatusResult> {
    const { data } = await this.authedPost<BkashExecuteResponse>(
      '/tokenized/checkout/payment/status',
      { paymentID: input.paymentRef },
    );
    return this.toStatus(input.paymentRef, data);
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    assertRefundInput(input, 'bkash');
    let trxID = input.transactionId;
    if (!trxID) {
      const status = await this.queryPayment({ paymentRef: input.paymentRef });
      trxID = status.transactionId;
    }
    if (!trxID) {
      throw new ValidationError('bKash refund requires the payment trxID', {
        gateway: 'bkash',
        raw: input,
      });
    }
    if (input.amount === undefined) {
      throw new ValidationError('bKash refund requires an explicit amount', {
        gateway: 'bkash',
      });
    }

    const { data } = await this.authedPost<BkashRefundResponse>(
      '/tokenized/checkout/payment/refund',
      {
        paymentID: input.paymentRef,
        trxID,
        amount: formatAmount(input.amount),
        sku: input.paymentRef,
        reason: input.reason ?? 'refund',
      },
    );

    const completed = (data.transactionStatus ?? '').toLowerCase() === 'completed';
    return {
      status: completed ? PaymentStatus.REFUNDED : PaymentStatus.FAILED,
      refundRef: data.refundTrxID,
      paymentRef: input.paymentRef,
      raw: data,
    };
  }

  /** Query the status of a refund by original trxID. */
  async queryRefund(paymentRef: string, trxID: string): Promise<RefundResult> {
    const { data } = await this.authedPost<BkashRefundResponse>(
      '/tokenized/checkout/payment/refund/status',
      { paymentID: paymentRef, trxID },
    );
    const completed = (data.transactionStatus ?? '').toLowerCase() === 'completed';
    return {
      status: completed ? PaymentStatus.REFUNDED : PaymentStatus.PENDING,
      refundRef: data.refundTrxID,
      paymentRef,
      raw: data,
    };
  }

  /**
   * bKash Tokenized Checkout has no signed server-to-server webhook. The gateway
   * redirects the customer to `callbackURL?paymentID=..&status=success|failure|cancel`.
   * Trusting that query alone is unsafe, so we re-query bKash for the
   * authoritative status and mark the result verified only if that succeeds.
   */
  async verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    const paymentID = input.payload['paymentID'];
    const callbackStatus = (input.payload['status'] ?? '').toLowerCase();
    if (!paymentID) {
      return {
        verified: false,
        status: PaymentStatus.FAILED,
        raw: input.payload,
      };
    }
    if (callbackStatus === 'cancel') {
      return {
        verified: true,
        status: PaymentStatus.CANCELLED,
        paymentRef: paymentID,
        raw: input.payload,
      };
    }
    // Authoritative check against bKash.
    const status = await this.queryPayment({ paymentRef: paymentID });
    return {
      verified: true,
      status: status.status,
      paymentRef: paymentID,
      orderId: status.orderId,
      transactionId: status.transactionId,
      raw: { callback: input.payload, query: status.raw },
    };
  }

  private toStatus(paymentRef: string, data: BkashExecuteResponse): StatusResult {
    return {
      status: normalizeBkashStatus(data.transactionStatus),
      paymentRef,
      orderId: data.merchantInvoiceNumber,
      transactionId: data.trxID,
      amount: data.amount ? Number(data.amount) : undefined,
      currency: 'BDT',
      providerStatus: data.transactionStatus,
      raw: data,
    };
  }
}

function isAuthFailure(status: number, data: { statusCode?: string }): boolean {
  if (status === 401 || status === 403) return true;
  // bKash auth-ish error codes when returned inside a 200 body.
  const code = data?.statusCode;
  return code === '2001' || code === '2002' || code === '2000';
}
