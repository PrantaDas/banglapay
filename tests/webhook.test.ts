import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SSLCommerzGateway } from '../src/gateways/sslcommerz/index.js';
import { BkashGateway } from '../src/gateways/bkash/index.js';
import { NagadGateway } from '../src/gateways/nagad/index.js';
import { PaymentStatus } from '../src/types/status.js';

const STORE_PASSWORD = 'testpass123';

/** Reproduce SSLCOMMERZ's IPN hash for a payload, to forge a valid signature. */
function signSSLIpn(payload: Record<string, string>, storePassword: string): string {
  const fields = (payload['verify_key'] ?? '').split(',').filter(Boolean);
  const pairs: Record<string, string> = {};
  for (const f of fields) pairs[f] = payload[f] ?? '';
  pairs['store_passwd'] = createHash('md5').update(storePassword).digest('hex');
  const qs = Object.keys(pairs)
    .sort()
    .map((k) => `${k}=${pairs[k]}`)
    .join('&');
  return createHash('md5').update(qs).digest('hex');
}

/** Build a fetch mock that routes by URL substring to canned JSON responses. */
function mockFetch(routes: Array<{ match: string; body: unknown; status?: number }>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString();
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`Unexpected fetch to ${url}`);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('SSLCOMMERZ IPN verification', () => {
  const gw = new SSLCommerzGateway(
    { storeId: 'teststore', storePassword: STORE_PASSWORD },
    'sandbox',
  );

  const basePayload: Record<string, string> = {
    tran_id: 'ORD-100',
    status: 'VALID',
    amount: '500.00',
    currency: 'BDT',
    bank_tran_id: 'BANK123',
    val_id: 'VAL123',
    verify_key: 'amount,bank_tran_id,currency,status,tran_id,val_id',
  };

  it('accepts a payload with a correct verify_sign', async () => {
    const payload = { ...basePayload };
    payload['verify_sign'] = signSSLIpn(payload, STORE_PASSWORD);

    const result = await gw.verifyWebhook({ payload });
    expect(result.verified).toBe(true);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.paymentRef).toBe('ORD-100');
    expect(result.transactionId).toBe('BANK123');
  });

  it('rejects a tampered amount', async () => {
    const payload = { ...basePayload };
    payload['verify_sign'] = signSSLIpn(payload, STORE_PASSWORD);
    payload['amount'] = '999.00'; // tamper after signing

    const result = await gw.verifyWebhook({ payload });
    expect(result.verified).toBe(false);
  });

  it('rejects a payload signed with the wrong store password', async () => {
    const payload = { ...basePayload };
    payload['verify_sign'] = signSSLIpn(payload, 'wrong-password');
    const result = await gw.verifyWebhook({ payload });
    expect(result.verified).toBe(false);
  });

  it('rejects when the signature is missing', async () => {
    const result = await gw.verifyWebhook({ payload: { ...basePayload } });
    expect(result.verified).toBe(false);
  });
});

describe('bKash callback verification', () => {
  const creds = {
    appKey: 'ak',
    appSecret: 'as',
    username: 'u',
    password: 'p',
  };

  it('marks a cancelled callback without any network call', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const gw = new BkashGateway(creds, 'sandbox', { fetchImpl });
    const result = await gw.verifyWebhook({
      payload: { paymentID: 'PAY1', status: 'cancel' },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe(PaymentStatus.CANCELLED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-queries bKash for the authoritative status on success', async () => {
    const fetchImpl = mockFetch([
      { match: '/token/grant', body: { id_token: 'tok', expires_in: 3600, refresh_token: 'r' } },
      {
        match: '/payment/status',
        body: {
          paymentID: 'PAY1',
          trxID: 'TRX9',
          transactionStatus: 'Completed',
          amount: '500',
          merchantInvoiceNumber: 'ORD-1',
        },
      },
    ]);
    const gw = new BkashGateway(creds, 'sandbox', { fetchImpl });
    const result = await gw.verifyWebhook({
      payload: { paymentID: 'PAY1', status: 'success' },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.transactionId).toBe('TRX9');
  });

  it('flags a callback missing paymentID', async () => {
    const gw = new BkashGateway(creds, 'sandbox', { fetchImpl: mockFetch([]) });
    const result = await gw.verifyWebhook({ payload: { status: 'success' } });
    expect(result.verified).toBe(false);
  });
});

describe('Nagad callback verification', () => {
  // Minimal valid RSA-shaped keys are not needed for the aborted path (no crypto),
  // but the constructor requires the fields to be present.
  const creds = {
    merchantId: 'M1',
    merchantPrivateKey: 'x',
    pgPublicKey: 'y',
  };

  it('marks an aborted callback as cancelled without crypto/network', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const gw = new NagadGateway(creds, 'sandbox', { fetchImpl });
    const result = await gw.verifyWebhook({
      payload: { payment_ref_id: 'REF1', status: 'Aborted' },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe(PaymentStatus.CANCELLED);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('re-queries the verify endpoint on success', async () => {
    const fetchImpl = mockFetch([
      {
        match: '/verify/payment/',
        body: { status: 'Success', orderId: 'ORD-1', issuerPaymentRefNo: 'NPAY1', amount: '500' },
      },
    ]);
    const gw = new NagadGateway(creds, 'sandbox', { fetchImpl });
    const result = await gw.verifyWebhook({
      payload: { payment_ref_id: 'REF1', status: 'Success' },
    });
    expect(result.verified).toBe(true);
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.transactionId).toBe('NPAY1');
  });
});
