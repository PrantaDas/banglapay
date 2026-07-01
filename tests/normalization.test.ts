import { describe, expect, it } from 'vitest';
import { normalizeSSLStatus } from '../src/gateways/sslcommerz/index.js';
import { normalizeBkashStatus } from '../src/gateways/bkash/index.js';
import { normalizeNagadStatus } from '../src/gateways/nagad/index.js';
import { PaymentStatus } from '../src/types/status.js';

describe('SSLCOMMERZ status normalization', () => {
  const cases: Array<[string, PaymentStatus]> = [
    ['VALID', PaymentStatus.SUCCESS],
    ['VALIDATED', PaymentStatus.SUCCESS],
    ['PENDING', PaymentStatus.PENDING],
    ['PROCESSING', PaymentStatus.PENDING],
    ['CANCELLED', PaymentStatus.CANCELLED],
    ['FAILED', PaymentStatus.FAILED],
    ['INVALID_TRANSACTION', PaymentStatus.FAILED],
    ['EXPIRED', PaymentStatus.FAILED],
  ];
  it.each(cases)('maps %s -> %s', (input, expected) => {
    expect(normalizeSSLStatus(input)).toBe(expected);
  });
  it('is case-insensitive and defaults unknown to PENDING', () => {
    expect(normalizeSSLStatus('valid')).toBe(PaymentStatus.SUCCESS);
    expect(normalizeSSLStatus('something-else')).toBe(PaymentStatus.PENDING);
    expect(normalizeSSLStatus(undefined)).toBe(PaymentStatus.PENDING);
  });
});

describe('bKash status normalization', () => {
  const cases: Array<[string, PaymentStatus]> = [
    ['Completed', PaymentStatus.SUCCESS],
    ['Initiated', PaymentStatus.PENDING],
    ['Pending', PaymentStatus.PENDING],
    ['Cancelled', PaymentStatus.CANCELLED],
    ['Failed', PaymentStatus.FAILED],
  ];
  it.each(cases)('maps %s -> %s', (input, expected) => {
    expect(normalizeBkashStatus(input)).toBe(expected);
  });
  it('defaults unknown to PENDING', () => {
    expect(normalizeBkashStatus('weird')).toBe(PaymentStatus.PENDING);
  });
});

describe('Nagad status normalization', () => {
  const cases: Array<[string, PaymentStatus]> = [
    ['Success', PaymentStatus.SUCCESS],
    ['Completed', PaymentStatus.SUCCESS],
    ['Pending', PaymentStatus.PENDING],
    ['In_Progress', PaymentStatus.PENDING],
    ['Aborted', PaymentStatus.CANCELLED],
    ['Refunded', PaymentStatus.REFUNDED],
    ['Partially_Refunded', PaymentStatus.PARTIALLY_REFUNDED],
    ['Failed', PaymentStatus.FAILED],
  ];
  it.each(cases)('maps %s -> %s', (input, expected) => {
    expect(normalizeNagadStatus(input)).toBe(expected);
  });
  it('defaults unknown to PENDING', () => {
    expect(normalizeNagadStatus('mystery')).toBe(PaymentStatus.PENDING);
  });
});
