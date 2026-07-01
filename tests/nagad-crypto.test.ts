import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, normalizePem, sign, verify } from '../src/gateways/nagad/crypto.js';
import { SignatureError } from '../src/core/errors.js';

function makeKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/** Strip PEM armor down to the bare base64 body Nagad often ships. */
function toBareBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
}

describe('nagad crypto', () => {
  const { publicKey, privateKey } = makeKeyPair();

  it('round-trips encrypt (public) -> decrypt (private)', () => {
    const plaintext = JSON.stringify({ merchantId: 'M123', orderId: 'ORD-1', challenge: 'abc' });
    const cipher = encrypt(plaintext, publicKey);
    expect(cipher).not.toContain(plaintext);
    expect(decrypt(cipher, privateKey)).toBe(plaintext);
  });

  it('produces a signature the matching public key verifies', () => {
    const message = 'the-exact-signed-string';
    const signature = sign(message, privateKey);
    expect(verify(message, signature, publicKey)).toBe(true);
  });

  it('rejects a tampered message', () => {
    const signature = sign('original', privateKey);
    expect(verify('tampered', signature, publicKey)).toBe(false);
  });

  it('rejects a signature from a different key', () => {
    const other = makeKeyPair();
    const signature = sign('msg', other.privateKey);
    expect(verify('msg', signature, publicKey)).toBe(false);
  });

  it('normalizes bare base64 keys (no PEM header) and still works', () => {
    const barePublic = toBareBase64(publicKey);
    const barePrivate = toBareBase64(privateKey);

    expect(normalizePem(barePublic, 'PUBLIC KEY')).toContain('-----BEGIN PUBLIC KEY-----');
    expect(normalizePem(barePrivate, 'PRIVATE KEY')).toContain('-----BEGIN PRIVATE KEY-----');

    const plaintext = 'roundtrip-with-bare-keys';
    const cipher = encrypt(plaintext, barePublic);
    expect(decrypt(cipher, barePrivate)).toBe(plaintext);

    const signature = sign(plaintext, barePrivate);
    expect(verify(plaintext, signature, barePublic)).toBe(true);
  });

  it('wraps bare base64 at 64-column boundaries', () => {
    const pem = normalizePem(toBareBase64(publicKey), 'PUBLIC KEY');
    const bodyLines = pem
      .split('\n')
      .filter((l) => !l.startsWith('-----'));
    for (const line of bodyLines) {
      expect(line.length).toBeLessThanOrEqual(64);
    }
  });

  it('throws SignatureError on undecryptable input', () => {
    expect(() => decrypt('not-valid-base64-cipher', privateKey)).toThrow(SignatureError);
  });
});
