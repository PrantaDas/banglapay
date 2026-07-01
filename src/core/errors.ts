import type { GatewayName } from '../types/status.js';

export interface PaymentErrorOptions {
  /** Gateway that produced the error, when known. */
  gateway?: GatewayName;
  /** Provider's own error/status code. */
  providerCode?: string;
  /** HTTP status, when the error originated from an HTTP response. */
  httpStatus?: number;
  /** Untouched provider payload for debugging. */
  raw?: unknown;
  /** Underlying error, if any. */
  cause?: unknown;
}

/**
 * Base class for every error thrown by the SDK. Subclasses classify the failure
 * so callers can `catch` broadly (`PaymentError`) or narrowly (`AuthError`).
 */
export class PaymentError extends Error {
  readonly gateway?: GatewayName;
  readonly providerCode?: string;
  readonly httpStatus?: number;
  readonly raw?: unknown;

  constructor(message: string, options: PaymentErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.gateway = options.gateway;
    this.providerCode = options.providerCode;
    this.httpStatus = options.httpStatus;
    this.raw = options.raw;
    // Restore prototype chain when compiled down to ES5-ish targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Authentication / authorization failure (bad credentials, expired token). */
export class AuthError extends PaymentError {}

/** Caller-supplied input failed validation before hitting the network. */
export class ValidationError extends PaymentError {}

/** The gateway accepted the request but reported a business/processing error. */
export class GatewayError extends PaymentError {}

/** Network-level failure: timeout, DNS, connection reset, non-JSON body. */
export class NetworkError extends PaymentError {}

/** Signature / hash verification failed on a webhook or crypto response. */
export class SignatureError extends PaymentError {}
