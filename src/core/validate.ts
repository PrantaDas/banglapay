import { ValidationError } from './errors.js';
import type { GatewayName } from '../types/status.js';
import type { InitPaymentInput, RefundInput } from '../types/results.js';

/** Shared, pre-network validation of caller input, with typed failures. */
export function assertInitInput(input: InitPaymentInput, gateway: GatewayName): void {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new ValidationError('amount must be a positive number', { gateway });
  }
  if (input.currency !== 'BDT') {
    throw new ValidationError(`Unsupported currency: ${String(input.currency)} (only BDT)`, {
      gateway,
    });
  }
  if (!input.orderId || input.orderId.trim() === '') {
    throw new ValidationError('orderId is required', { gateway });
  }
  assertHttpsUrl(input.callbackURL, 'callbackURL', gateway);
}

export function assertRefundInput(input: RefundInput, gateway: GatewayName): void {
  if (!input.paymentRef || input.paymentRef.trim() === '') {
    throw new ValidationError('paymentRef is required to refund', { gateway });
  }
  if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount <= 0)) {
    throw new ValidationError('refund amount must be a positive number', { gateway });
  }
}

export function assertHttpsUrl(value: string, field: string, gateway: GatewayName): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(`${field} must be a valid URL`, { gateway });
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`${field} must be an http(s) URL`, { gateway });
  }
}

/** Format an amount as a 2-decimal string, as most gateways require. */
export function formatAmount(amount: number): string {
  return amount.toFixed(2);
}
