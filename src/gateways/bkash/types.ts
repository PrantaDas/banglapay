/** bKash grant-token / refresh-token response. */
export interface BkashTokenResponse {
  statusCode?: string;
  statusMessage?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

/** bKash create-payment response. */
export interface BkashCreateResponse {
  statusCode?: string;
  statusMessage?: string;
  paymentID?: string;
  bkashURL?: string;
  callbackURL?: string;
  successCallbackURL?: string;
  failureCallbackURL?: string;
  cancelledCallbackURL?: string;
  amount?: string;
  intent?: string;
  currency?: string;
  paymentCreateTime?: string;
  transactionStatus?: string;
  merchantInvoiceNumber?: string;
  [key: string]: unknown;
}

/** bKash execute / query-payment response. */
export interface BkashExecuteResponse {
  statusCode?: string;
  statusMessage?: string;
  paymentID?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  intent?: string;
  paymentExecuteTime?: string;
  merchantInvoiceNumber?: string;
  customerMsisdn?: string;
  [key: string]: unknown;
}

/** bKash refund / refund-status response. */
export interface BkashRefundResponse {
  statusCode?: string;
  statusMessage?: string;
  originalTrxID?: string;
  refundTrxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  charge?: string;
  completedTime?: string;
  [key: string]: unknown;
}
