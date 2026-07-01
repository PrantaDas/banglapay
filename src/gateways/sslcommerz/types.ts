/** SSLCOMMERZ session init response (subset of returned fields). */
export interface SSLCommerzSessionResponse {
  status: 'SUCCESS' | 'FAILED';
  failedreason?: string;
  sessionkey?: string;
  GatewayPageURL?: string;
  redirectGatewayURL?: string;
  directPaymentURLBank?: string;
  gw?: Record<string, string>;
  [key: string]: unknown;
}

/** Response of validationserverAPI.php (order validation by val_id). */
export interface SSLCommerzValidationResponse {
  status?: 'VALID' | 'VALIDATED' | 'INVALID_TRANSACTION' | 'FAILED' | string;
  tran_id?: string;
  val_id?: string;
  amount?: string;
  store_amount?: string;
  currency?: string;
  bank_tran_id?: string;
  card_type?: string;
  error?: string;
  [key: string]: unknown;
}

/** Response of merchantTransIDvalidationAPI.php (query by tran_id). */
export interface SSLCommerzTransactionQueryResponse {
  APIConnect?: string;
  no_of_trans_found?: number;
  element?: SSLCommerzValidationResponse[];
  [key: string]: unknown;
}

/** Response of the refund initiate / refund query endpoints. */
export interface SSLCommerzRefundResponse {
  APIConnect?: string;
  bank_tran_id?: string;
  trans_id?: string;
  refund_ref_id?: string;
  status?: 'success' | 'processing' | 'failed' | string;
  errorReason?: string;
  [key: string]: unknown;
}
