<div align="center">

# 💳 banglapay

### One SDK for every Bangladeshi payment gateway

**bKash · Nagad · SSLCOMMERZ** — unified behind a single, type-safe, server-side TypeScript API.

[![npm version](https://img.shields.io/npm/v/banglapay.svg?color=cb0000&label=npm)](https://www.npmjs.com/package/banglapay)
[![types](https://img.shields.io/npm/types/banglapay.svg?color=3178c6)](https://www.typescriptlang.org/)
[![license](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![runtime](https://img.shields.io/badge/runtime-Node%2018%2B%20%7C%20Bun%20%7C%20Deno-43853d.svg)](#install)
[![deps](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#why-banglapay)

</div>

---

Stop re-wiring three different REST APIs, hand-writing request/response types, and
babysitting each gateway's auth quirks on every project. **`banglapay` normalizes all
of it:** one `PaymentClient`, one call shape, one status enum.

> Swap the `gateway` field and only the `credentials` change — **every call site stays
> identical.**

```ts
const { redirectURL, paymentRef } = await client.initPayment({
  amount: 500, currency: 'BDT', orderId: 'ORD-123',
  callbackURL: 'https://api.myapp.com/payments/callback',
});
const result = await client.executePayment({ paymentRef }); // → normalized StatusResult
```

---

## ✨ Why banglapay

| | |
| --- | --- |
| 🔒 **Server-side only** | Handles store passwords, app secrets, and RSA private keys. Never ships to the browser. |
| 🧩 **Framework-independent** | Pure TypeScript. Identical on Node 18+, Bun, and Deno. Returns data — never owns your routes. |
| 📦 **Zero runtime deps** | Native `fetch` + Node `crypto`. Nothing else. |
| 🧠 **Type-safe by design** | Discriminated-union config — wrong credentials fail at **compile time**. |
| 🔁 **Normalized everything** | One `PaymentStatus` enum, shared result types, and always the raw provider payload. |
| ⚡ **Dual ESM + CJS** | Ships `.mjs`, `.cjs`, and generated `.d.ts`. |

> Checkout flow only — no recurring/agreement or disbursement/payout APIs.

---

## 🚀 Install

```bash
npm install banglapay
# or
pnpm add banglapay
# or
bun add banglapay
```

Requires **Node 18+** (or Bun / Deno) for global `fetch` and Web Crypto.

> [!WARNING]
> **Never bundle this into frontend code.** It manipulates secret credentials and
> signs requests. Keep it in your backend / API layer only.

---

## ⚡ Quick start

```ts
import { PaymentClient } from 'banglapay';

const client = new PaymentClient({
  gateway: 'sslcommerz',        // 'bkash' | 'nagad' | 'sslcommerz'
  mode: 'sandbox',              // 'sandbox' | 'live'
  credentials: {                // shape enforced per-gateway at compile time
    storeId: process.env.SSLC_STORE_ID!,
    storePassword: process.env.SSLC_STORE_PASSWORD!,
  },
});

// 1️⃣  Start a checkout — redirect the customer to redirectURL.
const { redirectURL, paymentRef } = await client.initPayment({
  amount: 500,
  currency: 'BDT',
  orderId: 'ORD-123',
  callbackURL: 'https://api.myapp.com/payments/callback',
});

// 2️⃣  After the customer returns, confirm/settle the payment.
const result = await client.executePayment({ paymentRef });
if (result.status === 'SUCCESS') {
  // fulfill the order 🎉
}
```

`initPayment`, `executePayment`, `queryPayment`, `refund`, and `verifyWebhook` are
**identical across all three gateways.** Only the constructor `credentials` differ.

---

## 🗺️ Supported gateways

| Gateway | Flow | Auth model | Webhook / callback |
| --- | --- | --- | --- |
| **SSLCOMMERZ** | Hosted checkout → validate → refund | Store id + password | Signed IPN (md5 hash) ✅ |
| **bKash** | Tokenized Checkout: create → execute | OAuth token (auto-managed) | Unsigned redirect → re-query 🔁 |
| **Nagad** | Initialize → complete handshake | RSA encrypt + sign | Unsigned redirect → re-query 🔁 |

---

## 🧬 Normalized model

Every provider response maps onto shared types, and the untouched provider payload is
always available as `raw`.

```ts
enum PaymentStatus {
  PENDING, SUCCESS, FAILED, CANCELLED, REFUNDED, PARTIALLY_REFUNDED
}

interface StatusResult {
  status: PaymentStatus;
  paymentRef: string;
  orderId?: string;
  transactionId?: string;
  amount?: number;
  currency?: 'BDT';
  providerStatus?: string;  // provider's own string, pre-normalization
  raw: unknown;             // untouched provider response
}
```

### 🧯 Errors

All failures throw a subclass of `PaymentError` — catch broadly or narrowly.

| Class | Meaning |
| --- | --- |
| `PaymentError` | Base class for everything below. |
| `AuthError` | Bad credentials / expired or rejected token. |
| `ValidationError` | Your input failed validation before any network call. |
| `GatewayError` | Provider accepted the request but reported a business error. |
| `NetworkError` | Timeout, DNS, connection reset, or non-JSON transport error. |
| `SignatureError` | Webhook hash / RSA verification failed. |

Each carries `gateway`, `providerCode`, `httpStatus`, and `raw` where available.

---

## 🔧 Per-gateway setup

<details open>
<summary><b>🟢 SSLCOMMERZ</b></summary>

<br>

Credentials come from the [SSLCOMMERZ merchant panel](https://developer.sslcommerz.com/).

```ts
const client = new PaymentClient({
  gateway: 'sslcommerz',
  mode: 'sandbox',
  credentials: {
    storeId: 'yourstore',
    storePassword: 'yourpassword',
  },
});

const { redirectURL, paymentRef } = await client.initPayment({
  amount: 1200, currency: 'BDT', orderId: 'ORD-501',
  callbackURL: 'https://api.myapp.com/payments/sslc/callback',
  customer: { name: 'Karim', email: 'karim@example.com', phone: '01700000000' },
});
// → redirect customer to redirectURL

// On the callback/IPN: verify the signed payload (see snippet below), then:
const status = await client.queryPayment({ paymentRef });

// Refund (needs an amount; transactionId auto-resolved if omitted):
await client.refund({ paymentRef, amount: 1200, reason: 'customer request' });
```

- Hosted checkout → redirect → IPN hash verification → validate/query → refund +
  refund query are all handled for you.
- `executePayment` and `queryPayment` both resolve status via the transaction query
  API (SSLCOMMERZ has no separate capture step).
- Sandbox vs live is only a base-URL switch.

</details>

<details>
<summary><b>🔴 bKash (Tokenized Checkout)</b></summary>

<br>

Credentials come from your bKash merchant onboarding.

```ts
const client = new PaymentClient({
  gateway: 'bkash',
  mode: 'sandbox',
  credentials: {
    appKey: process.env.BKASH_APP_KEY!,
    appSecret: process.env.BKASH_APP_SECRET!,
    username: process.env.BKASH_USERNAME!,
    password: process.env.BKASH_PASSWORD!,
  },
});

const { redirectURL, paymentRef } = await client.initPayment({
  amount: 500, currency: 'BDT', orderId: 'INV-77',
  callbackURL: 'https://api.myapp.com/payments/bkash/callback',
});
// → redirect customer to redirectURL (bkashURL)

// bKash returns to your callbackURL with ?paymentID=..&status=success — execute to capture:
const result = await client.executePayment({ paymentRef });

// Refund (amount required; trxID auto-resolved if omitted):
await client.refund({ paymentRef, amount: 500, reason: 'refund' });
```

> [!NOTE]
> **Token lifecycle is fully automatic.** The SDK caches the bearer token in memory,
> refreshes it ~60s before its ~1h expiry, retries once on an auth failure, and
> re-grants if a refresh is rejected. You never touch `id_token` or `refresh_token`.

bKash Tokenized Checkout has no signed server-to-server webhook — the browser is
redirected to your `callbackURL` with a `status` query param. `verifyWebhook`
therefore **re-queries bKash** for the authoritative status instead of trusting it.

</details>

<details>
<summary><b>🟠 Nagad</b></summary>

<br>

Nagad uses an RSA layer: you encrypt payloads with **Nagad's PG public key** and sign
with your **merchant private key**; the SDK decrypts/verifies Nagad's responses. Keys
may be full PEM **or** the bare base64 body — both are normalized internally.

```ts
const client = new PaymentClient(
  {
    gateway: 'nagad',
    mode: 'sandbox',
    credentials: {
      merchantId: process.env.NAGAD_MERCHANT_ID!,
      merchantPrivateKey: process.env.NAGAD_MERCHANT_PRIVATE_KEY!, // PKCS#8
      pgPublicKey: process.env.NAGAD_PG_PUBLIC_KEY!,
      merchantNumber: process.env.NAGAD_MERCHANT_NUMBER,
    },
  },
  { clientIp: '203.0.113.10' }, // sent as X-KM-IP-V4 (Nagad requires a value)
);

const { redirectURL, paymentRef } = await client.initPayment({
  amount: 750, currency: 'BDT', orderId: 'NGD-9',
  callbackURL: 'https://api.myapp.com/payments/nagad/callback',
});
// The SDK runs Nagad's initialize + complete handshake server-side and hands you
// the customer redirect URL. → redirect customer to redirectURL.

const result = await client.queryPayment({ paymentRef });
```

- RSA crypto is implemented against Node `crypto` and unit-tested in isolation
  (`tests/nagad-crypto.test.ts`): PKCS#1 v1.5 padding, PEM normalization, sign,
  verify, encrypt/decrypt round-trips.
- Decryption uses `RSA_NO_PADDING` + manual v1.5 unpadding because modern Node blocks
  `RSA_PKCS1_PADDING` on private decryption ([CVE-2023-46809](https://nvd.nist.gov/vuln/detail/CVE-2023-46809))
  — functionally identical for Nagad, and future-proof.
- Nagad refund availability depends on your merchant agreement; unsupported accounts
  surface a `GatewayError`.

</details>

---

## 🪝 Framework-agnostic callback route

The SDK never owns routes — wire it into whatever router you use. Same pattern
everywhere: parse the inbound body into a flat `Record<string, string>`, call
`verifyWebhook`, then act on the normalized result.

```ts
// Pseudocode — works with Express, Fastify, Hono, Next.js route handlers, etc.
async function handleCallback(req, res) {
  // SSLCOMMERZ IPN is form-encoded; bKash/Nagad are query params.
  const payload: Record<string, string> = parseBodyOrQuery(req);

  const result = await client.verifyWebhook({
    payload,
    headers: lowercaseHeaders(req.headers), // only for header-signed gateways
  });

  if (!result.verified) return res.status(400).send('invalid signature');

  switch (result.status) {
    case 'SUCCESS':
      await fulfillOrder(result.orderId, result.transactionId);
      break;
    case 'CANCELLED':
    case 'FAILED':
      await markOrderFailed(result.paymentRef);
      break;
  }
  return res.status(200).send('OK');
}
```

<details>
<summary>Minimal Express example</summary>

<br>

```ts
import express from 'express';
import { PaymentClient } from 'banglapay';

const app = express();
app.use(express.urlencoded({ extended: true })); // SSLCOMMERZ IPN is form-encoded

app.post('/payments/callback', async (req, res) => {
  const result = await client.verifyWebhook({ payload: req.body });
  res.status(result.verified ? 200 : 400).send(result.verified ? 'OK' : 'bad sign');
});
```

</details>

---

## 📚 API surface

```ts
class PaymentClient implements IPaymentGateway {
  constructor(config: PaymentConfig, options?: PaymentClientOptions);
  initPayment(input: InitPaymentInput): Promise<InitPaymentResult>;
  executePayment(input: { paymentRef: string }): Promise<StatusResult>;
  queryPayment(input: { paymentRef: string }): Promise<StatusResult>;
  refund(input: RefundInput): Promise<RefundResult>;
  verifyWebhook(input: WebhookVerifyInput): Promise<WebhookResult>;
  raw(): IPaymentGateway; // escape hatch to gateway-specific extras
}
```

- `PaymentConfig` is a **discriminated union** on `gateway` — TypeScript rejects the
  wrong or missing credential fields at compile time.
- `options` accepts `fetchImpl` (tests/proxies) and `clientIp` (Nagad's `X-KM-IP-V4`).
- Concrete adapters (`SSLCommerzGateway`, `BkashGateway`, `NagadGateway`) and the
  status normalizers are also exported for advanced use.

---

## 🛠️ Development

```bash
npm install
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest: nagad crypto, webhook verification, status mapping
npm run build       # tsup → dual ESM + CJS + .d.ts in dist/
```

---

## 📁 Project layout

```
src/
├─ core/        PaymentClient · http · errors · validate
├─ gateways/
│  ├─ sslcommerz/   adapter + provider types
│  ├─ bkash/        adapter + token lifecycle + provider types
│  └─ nagad/        adapter + RSA crypto + provider types
├─ types/       normalized status · results · config union · gateway interface
└─ index.ts     public entry point
```

---

## 📄 License

[MIT](./LICENSE) © [Pranta Das](https://github.com/Prantadas)

<div align="center">
<sub>Built for developers shipping payments in 🇧🇩 Bangladesh.</sub>
</div>
