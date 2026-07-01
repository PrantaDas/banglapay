/**
 * Normalized payment lifecycle status shared across every gateway.
 * Provider-specific status strings are mapped onto this enum by each adapter.
 */
export enum PaymentStatus {
  /** Payment created / awaiting customer action or provider confirmation. */
  PENDING = 'PENDING',
  /** Payment completed and funds captured. */
  SUCCESS = 'SUCCESS',
  /** Payment attempt failed or was declined. */
  FAILED = 'FAILED',
  /** Customer aborted the payment. */
  CANCELLED = 'CANCELLED',
  /** Full amount refunded. */
  REFUNDED = 'REFUNDED',
  /** A portion of the amount refunded. */
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export type Currency = 'BDT';

/** Supported gateway identifiers. */
export type GatewayName = 'bkash' | 'nagad' | 'sslcommerz';

/** Sandbox vs production endpoints. */
export type PaymentMode = 'sandbox' | 'live';
