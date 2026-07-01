import { ValidationError } from './errors.js';
import { BkashGateway } from '../gateways/bkash/index.js';
import { NagadGateway } from '../gateways/nagad/index.js';
import { SSLCommerzGateway } from '../gateways/sslcommerz/index.js';
import type { PaymentConfig } from '../types/config.js';
import type { IPaymentGateway } from '../types/gateway.js';
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
} from '../types/results.js';

/** Extra runtime knobs not tied to a single gateway's credentials. */
export interface PaymentClientOptions {
  /** Injectable fetch implementation (mainly for tests). */
  fetchImpl?: typeof fetch;
  /** Nagad-only: IPv4 for the X-KM-IP-V4 header. */
  clientIp?: string;
}

/**
 * Thin facade over the gateway adapters. Construct it with a discriminated
 * {@link PaymentConfig}; the `gateway` field selects the adapter and fixes the
 * `credentials` shape at compile time. All call sites are gateway-agnostic.
 */
export class PaymentClient implements IPaymentGateway {
  private readonly adapter: IPaymentGateway;
  readonly gateway: PaymentConfig['gateway'];

  constructor(config: PaymentConfig, options: PaymentClientOptions = {}) {
    this.gateway = config.gateway;
    this.adapter = createAdapter(config, options);
  }

  initPayment(input: InitPaymentInput): Promise<InitPaymentResult> {
    return this.adapter.initPayment(input);
  }

  executePayment(input: ExecutePaymentInput): Promise<StatusResult> {
    return this.adapter.executePayment(input);
  }

  queryPayment(input: QueryPaymentInput): Promise<StatusResult> {
    return this.adapter.queryPayment(input);
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return this.adapter.refund(input);
  }

  verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult> {
    return this.adapter.verifyWebhook(input);
  }

  /** Escape hatch to the concrete adapter for gateway-specific extras. */
  raw(): IPaymentGateway {
    return this.adapter;
  }
}

function createAdapter(config: PaymentConfig, options: PaymentClientOptions): IPaymentGateway {
  const shared = { timeoutMs: config.timeoutMs, fetchImpl: options.fetchImpl };
  switch (config.gateway) {
    case 'sslcommerz':
      return new SSLCommerzGateway(config.credentials, config.mode, shared);
    case 'bkash':
      return new BkashGateway(config.credentials, config.mode, shared);
    case 'nagad':
      return new NagadGateway(config.credentials, config.mode, {
        ...shared,
        clientIp: options.clientIp,
      });
    default: {
      // Exhaustiveness guard — unreachable if the union is respected.
      const never: never = config;
      throw new ValidationError(`Unknown gateway: ${JSON.stringify(never)}`);
    }
  }
}
