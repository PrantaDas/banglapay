import type { PaymentMode } from './status.js';

/** SSLCOMMERZ: store id + store password from the merchant panel. */
export interface SSLCommerzCredentials {
  storeId: string;
  storePassword: string;
}

/** bKash Tokenized Checkout app + merchant credentials. */
export interface BkashCredentials {
  appKey: string;
  appSecret: string;
  username: string;
  password: string;
}

/**
 * Nagad merchant credentials.
 * Keys are the base64 body of the PEM (with or without header lines) or a full
 * PEM string — the crypto layer normalizes both.
 */
export interface NagadCredentials {
  merchantId: string;
  /** Merchant's own RSA private key (PKCS#8). Used to sign + decrypt. */
  merchantPrivateKey: string;
  /** Nagad PG public key. Used to encrypt + verify. */
  pgPublicKey: string;
  /** Registered merchant mobile number (optional, some flows require it). */
  merchantNumber?: string;
}

/**
 * Discriminated union: `gateway` selects the adapter and fixes the exact shape
 * of `credentials`. Wrong or missing credential fields fail at compile time.
 */
export type PaymentConfig =
  | {
      gateway: 'sslcommerz';
      mode: PaymentMode;
      credentials: SSLCommerzCredentials;
      /** Optional per-request timeout in ms (default 30000). */
      timeoutMs?: number;
    }
  | {
      gateway: 'bkash';
      mode: PaymentMode;
      credentials: BkashCredentials;
      timeoutMs?: number;
    }
  | {
      gateway: 'nagad';
      mode: PaymentMode;
      credentials: NagadCredentials;
      timeoutMs?: number;
    };
