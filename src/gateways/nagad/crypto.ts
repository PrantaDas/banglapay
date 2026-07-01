import {
  constants as cryptoConstants,
  createSign,
  createVerify,
  privateDecrypt,
  publicEncrypt,
} from 'node:crypto';
import { SignatureError } from '../../core/errors.js';

/**
 * Nagad's RSA layer. All operations use RSA/ECB/PKCS1 (v1.5) padding with
 * SHA-256 signatures, matching Nagad's PG. Keys may be supplied either as a full
 * PEM string or as the bare base64 DER body — {@link normalizePem} handles both.
 */

const PKCS1_PADDING = cryptoConstants.RSA_PKCS1_PADDING;

type PemLabel = 'PUBLIC KEY' | 'PRIVATE KEY';

/**
 * Wrap/repair a key into valid PEM. Accepts:
 *  - a complete PEM (returned untouched, aside from CRLF cleanup),
 *  - a bare base64 DER body (wrapped with the given header + 64-col line breaks).
 */
export function normalizePem(key: string, label: PemLabel): string {
  const trimmed = key.trim();
  if (trimmed.includes('-----BEGIN')) {
    // Already PEM — normalize line endings only.
    return trimmed.replace(/\r\n/g, '\n');
  }
  const body = trimmed.replace(/\s+/g, '');
  const lines = body.match(/.{1,64}/g) ?? [body];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/** Encrypt UTF-8 plaintext with Nagad's PG public key -> base64. */
export function encrypt(plaintext: string, pgPublicKey: string): string {
  const key = normalizePem(pgPublicKey, 'PUBLIC KEY');
  try {
    const buf = publicEncrypt(
      { key, padding: PKCS1_PADDING },
      Buffer.from(plaintext, 'utf8'),
    );
    return buf.toString('base64');
  } catch (err) {
    throw new SignatureError('Nagad public-key encryption failed', {
      gateway: 'nagad',
      cause: err,
    });
  }
}

/**
 * Decrypt base64 ciphertext with the merchant private key -> UTF-8 plaintext.
 *
 * Nagad uses RSA PKCS#1 v1.5 padding, but modern Node (18.19+/20.11+/21+) blocks
 * `RSA_PKCS1_PADDING` for private decryption to mitigate CVE-2023-46809
 * (Bleichenbacher). We therefore decrypt with `RSA_NO_PADDING` and strip the
 * v1.5 type-2 padding ourselves, which is functionally identical for Nagad.
 */
export function decrypt(cipherBase64: string, merchantPrivateKey: string): string {
  const key = normalizePem(merchantPrivateKey, 'PRIVATE KEY');
  try {
    const raw = privateDecrypt(
      { key, padding: cryptoConstants.RSA_NO_PADDING },
      Buffer.from(cipherBase64, 'base64'),
    );
    return stripPkcs1v15(raw).toString('utf8');
  } catch (err) {
    if (err instanceof SignatureError) throw err;
    throw new SignatureError('Nagad private-key decryption failed', {
      gateway: 'nagad',
      cause: err,
    });
  }
}

/**
 * Remove PKCS#1 v1.5 type-2 padding from a raw RSA block:
 *   0x00 || 0x02 || PS (>= 8 non-zero bytes) || 0x00 || message
 */
function stripPkcs1v15(block: Buffer): Buffer {
  if (block.length < 11 || block[0] !== 0x00 || block[1] !== 0x02) {
    throw new SignatureError('Nagad decryption produced invalid PKCS#1 padding', {
      gateway: 'nagad',
    });
  }
  let sep = 2;
  while (sep < block.length && block[sep] !== 0x00) sep++;
  if (sep === block.length || sep < 10) {
    throw new SignatureError('Nagad decryption produced invalid PKCS#1 padding', {
      gateway: 'nagad',
    });
  }
  return block.subarray(sep + 1);
}

/** Sign UTF-8 plaintext with the merchant private key (SHA-256) -> base64. */
export function sign(plaintext: string, merchantPrivateKey: string): string {
  const key = normalizePem(merchantPrivateKey, 'PRIVATE KEY');
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(plaintext, 'utf8');
    signer.end();
    return signer.sign(key, 'base64');
  } catch (err) {
    throw new SignatureError('Nagad signing failed', { gateway: 'nagad', cause: err });
  }
}

/** Verify a base64 SHA-256 signature against Nagad's PG public key. */
export function verify(plaintext: string, signatureBase64: string, pgPublicKey: string): boolean {
  const key = normalizePem(pgPublicKey, 'PUBLIC KEY');
  try {
    const verifier = createVerify('RSA-SHA256');
    verifier.update(plaintext, 'utf8');
    verifier.end();
    return verifier.verify(key, signatureBase64, 'base64');
  } catch (err) {
    throw new SignatureError('Nagad signature verification failed', {
      gateway: 'nagad',
      cause: err,
    });
  }
}
