/** Envelope Nagad uses for encrypted request/response bodies. */
export interface NagadSecureEnvelope {
  sensitiveData?: string;
  signature?: string;
  [key: string]: unknown;
}

/** Decrypted payload of the initialize response. */
export interface NagadInitDecrypted {
  paymentReferenceId: string;
  challenge: string;
  acceptDateTime?: string;
}

/** Response of the complete/checkout call (after decrypt where needed). */
export interface NagadCompleteResponse extends NagadSecureEnvelope {
  status?: string;
  message?: string;
  callBackUrl?: string;
}

/** Decrypted payload returned by complete. */
export interface NagadCompleteDecrypted {
  merchantId?: string;
  orderId?: string;
  paymentRefId?: string;
  amount?: string;
  challenge?: string;
  status?: string;
}

/** Response of the verify/payment status endpoint (plain JSON). */
export interface NagadVerifyResponse {
  merchantId?: string;
  orderId?: string;
  paymentRefId?: string;
  amount?: string;
  clientMobileNo?: string;
  merchantMobileNo?: string;
  orderDateTime?: string;
  issuerPaymentDateTime?: string;
  issuerPaymentRefNo?: string;
  additionalMerchantInfo?: unknown;
  status?: string;
  statusCode?: string;
  [key: string]: unknown;
}

/** Response of the refund endpoint. */
export interface NagadRefundResponse {
  status?: string;
  message?: string;
  refundRefId?: string;
  [key: string]: unknown;
}
