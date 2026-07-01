import type { Currency, PaymentStatus } from './status.js';

/** Optional customer details some gateways require or benefit from. */
export interface CustomerInfo {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
}

/** Input to {@link IPaymentGateway.initPayment}. Identical across gateways. */
export interface InitPaymentInput {
  /** Amount in major currency units (e.g. 500 = 500 BDT). */
  amount: number;
  currency: Currency;
  /** Merchant order/invoice id. Must be unique per attempt. */
  orderId: string;
  /**
   * URL the gateway redirects the customer back to after payment.
   * Also used as the IPN/webhook target where the gateway supports it.
   */
  callbackURL: string;
  customer?: CustomerInfo;
  /** Free-form label shown on some checkout pages. */
  productName?: string;
  /** Arbitrary key/values echoed back where the gateway supports it. */
  metadata?: Record<string, string>;
}

/** Result of a successful init: where to send the customer + a handle. */
export interface InitPaymentResult {
  /** URL to redirect the customer's browser to (hosted checkout). */
  redirectURL: string;
  /**
   * Opaque handle used for every subsequent call (execute/query/refund).
   * Encodes whatever the provider needs (payment id, tran id, ref id).
   */
  paymentRef: string;
  /** Untouched provider response. */
  raw: unknown;
}

export interface ExecutePaymentInput {
  paymentRef: string;
}

export interface QueryPaymentInput {
  paymentRef: string;
}

/** Normalized status/result of a payment, shared by execute + query. */
export interface StatusResult {
  status: PaymentStatus;
  paymentRef: string;
  /** Merchant order id, when the provider returns it. */
  orderId?: string;
  /** Provider-side transaction id (present once paid). */
  transactionId?: string;
  amount?: number;
  currency?: Currency;
  /** Provider's own status string, before normalization. */
  providerStatus?: string;
  /** Untouched provider response. */
  raw: unknown;
}

export interface RefundInput {
  paymentRef: string;
  /** Amount to refund. Omit for a full refund where the provider allows it. */
  amount?: number;
  reason?: string;
  /** Provider transaction id, required by some gateways for refunds. */
  transactionId?: string;
}

export interface RefundResult {
  status: PaymentStatus;
  /** Provider refund reference id, when returned. */
  refundRef?: string;
  paymentRef: string;
  raw: unknown;
}

/** Raw inbound webhook/IPN/callback payload to verify. */
export interface WebhookVerifyInput {
  /**
   * Parsed key/value payload of the notification.
   * For form-encoded IPNs, parse into an object first.
   */
  payload: Record<string, string>;
  /** Raw HTTP headers, lowercased keys, when the gateway signs via headers. */
  headers?: Record<string, string>;
}

export interface WebhookResult {
  /** Whether the signature/hash proved the payload is authentic. */
  verified: boolean;
  status: PaymentStatus;
  paymentRef?: string;
  orderId?: string;
  transactionId?: string;
  raw: unknown;
}
