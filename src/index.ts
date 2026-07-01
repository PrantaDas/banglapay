// Public entry point for banglapay — a unified, server-side TypeScript SDK for
// Bangladesh payment gateways (bKash, Nagad, SSLCOMMERZ).

export { PaymentClient } from './core/PaymentClient.js';
export type { PaymentClientOptions } from './core/PaymentClient.js';

// Error hierarchy.
export {
  PaymentError,
  AuthError,
  ValidationError,
  GatewayError,
  NetworkError,
  SignatureError,
} from './core/errors.js';
export type { PaymentErrorOptions } from './core/errors.js';

// Shared / normalized types.
export * from './types/index.js';

// Status-normalization helpers (handy for tests + advanced callers).
export { normalizeSSLStatus } from './gateways/sslcommerz/index.js';
export { normalizeBkashStatus } from './gateways/bkash/index.js';
export { normalizeNagadStatus } from './gateways/nagad/index.js';

// Concrete adapters, for callers who prefer wiring one directly.
export { SSLCommerzGateway } from './gateways/sslcommerz/index.js';
export { BkashGateway } from './gateways/bkash/index.js';
export { NagadGateway } from './gateways/nagad/index.js';
