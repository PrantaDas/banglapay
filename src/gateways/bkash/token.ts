import { AuthError } from '../../core/errors.js';
import type { HttpClient } from '../../core/http.js';
import type { BkashCredentials } from '../../types/config.js';
import type { BkashTokenResponse } from './types.js';

interface CachedToken {
  idToken: string;
  refreshToken: string;
  /** Epoch ms after which the token is considered expired. */
  expiresAt: number;
}

/** Refresh this many ms before actual expiry to avoid mid-flight expiry. */
const EXPIRY_BUFFER_MS = 60_000;

/**
 * In-memory bKash token lifecycle manager. Grants on first use, caches the
 * bearer token, and transparently refreshes (or re-grants) before expiry.
 * Concurrent callers share a single in-flight grant/refresh promise.
 */
export class BkashTokenManager {
  private token: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly http: HttpClient,
    private readonly baseURL: string,
    private readonly credentials: BkashCredentials,
  ) {}

  /** Return a valid id_token, granting/refreshing as needed. */
  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAt - EXPIRY_BUFFER_MS) {
      return this.token.idToken;
    }
    if (this.inflight) return this.inflight;

    const attempt = this.token ? this.refresh(this.token.refreshToken) : this.grant();
    this.inflight = attempt.finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Force a fresh grant (e.g. after a 401). */
  async forceGrant(): Promise<string> {
    this.token = null;
    return this.getToken();
  }

  private authHeaders(): Record<string, string> {
    return {
      username: this.credentials.username,
      password: this.credentials.password,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async grant(): Promise<string> {
    const res = await this.http.request<BkashTokenResponse>({
      method: 'POST',
      url: `${this.baseURL}/tokenized/checkout/token/grant`,
      headers: this.authHeaders(),
      body: {
        app_key: this.credentials.appKey,
        app_secret: this.credentials.appSecret,
      },
    });
    return this.store(res.data, res.status);
  }

  private async refresh(refreshToken: string): Promise<string> {
    const res = await this.http.request<BkashTokenResponse>({
      method: 'POST',
      url: `${this.baseURL}/tokenized/checkout/token/refresh`,
      headers: this.authHeaders(),
      body: {
        app_key: this.credentials.appKey,
        app_secret: this.credentials.appSecret,
        refresh_token: refreshToken,
      },
    });
    // If refresh is rejected, fall back to a fresh grant.
    if (res.status < 200 || res.status >= 300 || !res.data.id_token) {
      this.token = null;
      return this.grant();
    }
    return this.store(res.data, res.status);
  }

  private store(data: BkashTokenResponse, httpStatus: number): string {
    if (!data.id_token) {
      throw new AuthError(data.statusMessage ?? 'bKash token grant failed', {
        gateway: 'bkash',
        providerCode: data.statusCode,
        httpStatus,
        raw: data,
      });
    }
    const expiresInSec = data.expires_in ?? 3600;
    this.token = {
      idToken: data.id_token,
      refreshToken: data.refresh_token ?? this.token?.refreshToken ?? '',
      expiresAt: Date.now() + expiresInSec * 1000,
    };
    return data.id_token;
  }
}
