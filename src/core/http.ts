import { NetworkError } from './errors.js';
import type { GatewayName } from '../types/status.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Object serialized to JSON, or a pre-built body string. */
  body?: unknown;
  /** Encoding for the request body. Defaults to 'json'. */
  bodyType?: 'json' | 'form' | 'raw';
  /** Override the client default timeout for this call. */
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Parsed JSON when the response is JSON, otherwise the raw text. */
  data: T;
  /** Raw response text, always populated. */
  text: string;
}

export interface HttpClientOptions {
  gateway: GatewayName;
  defaultTimeoutMs?: number;
  /** Injectable fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

function encodeForm(body: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    params.append(key, String(value));
  }
  return params.toString();
}

/**
 * Thin typed wrapper over native `fetch`: applies a timeout via AbortController,
 * encodes JSON/form bodies, parses JSON responses, and maps transport failures
 * onto {@link NetworkError}. It never throws on non-2xx — adapters decide how to
 * interpret provider error bodies.
 */
export class HttpClient {
  private readonly gateway: GatewayName;
  private readonly defaultTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.gateway = options.gateway;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    const impl = options.fetchImpl ?? globalThis.fetch;
    if (typeof impl !== 'function') {
      throw new NetworkError(
        'Global fetch is not available. Use Node 18+, Bun, Deno, or pass fetchImpl.',
        { gateway: options.gateway },
      );
    }
    this.fetchImpl = impl;
  }

  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeout = req.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => controller.abort(), timeout);

    const headers: Record<string, string> = { ...req.headers };
    let body: string | undefined;

    if (req.body !== undefined && req.method !== 'GET') {
      const bodyType = req.bodyType ?? 'json';
      if (bodyType === 'json') {
        body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        headers['Content-Type'] ??= 'application/json';
      } else if (bodyType === 'form') {
        body = encodeForm(req.body as Record<string, unknown>);
        headers['Content-Type'] ??= 'application/x-www-form-urlencoded';
      } else {
        body = String(req.body);
      }
    }

    let res: Response;
    try {
      res = await this.fetchImpl(req.url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new NetworkError(
        aborted
          ? `Request to ${req.url} timed out after ${timeout}ms`
          : `Network request to ${req.url} failed`,
        { gateway: this.gateway, cause: err },
      );
    }
    clearTimeout(timer);

    const text = await res.text();
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    let data: unknown = text;
    const contentType = responseHeaders['content-type'] ?? '';
    if (contentType.includes('application/json') || looksLikeJson(text)) {
      try {
        data = text.length > 0 ? JSON.parse(text) : {};
      } catch {
        data = text;
      }
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: responseHeaders,
      data: data as T,
      text,
    };
  }
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith('{') || t.startsWith('[');
}
