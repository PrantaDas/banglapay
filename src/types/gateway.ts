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
} from './results.js';

/**
 * Common contract every gateway adapter implements. `PaymentClient` delegates
 * to one of these; call sites are identical regardless of gateway.
 */
export interface IPaymentGateway {
  /** Create a checkout session and return a redirect URL + payment handle. */
  initPayment(input: InitPaymentInput): Promise<InitPaymentResult>;

  /**
   * Finalize/confirm a payment after the customer returns.
   * For gateways without an explicit capture step this resolves current status.
   */
  executePayment(input: ExecutePaymentInput): Promise<StatusResult>;

  /** Fetch the authoritative current status of a payment. */
  queryPayment(input: QueryPaymentInput): Promise<StatusResult>;

  /** Refund a captured payment, fully or partially. */
  refund(input: RefundInput): Promise<RefundResult>;

  /**
   * Verify an inbound webhook/IPN/callback and return its normalized result.
   * Synchronous-signature but async because some gateways require a re-query.
   */
  verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult>;
}
