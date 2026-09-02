import "server-only";
import { serverEnv } from "@/lib/env";
import { logger, sanitizeErrorMessage } from "@/lib/logger";
import type { ConnectionStatus } from "@/lib/enums";

/**
 * Shared provider HTTP client.
 *
 * SSRF note: `baseUrl` is always a trusted, server-controlled constant defined
 * in the adapter - it is never user-configurable. `request()` additionally
 * re-validates that the resolved URL still points at the adapter's own origin,
 * so a crafted path or a provider-supplied pagination link cannot redirect the
 * backend at an internal host. Redirects are not followed for the same reason.
 */

export interface ProviderHttpOptions {
  baseUrl: string;
  /** Used for log correlation only. */
  providerSlug: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Overrides the client default for this call. */
  maxRetries?: number;
}

export interface ProviderResponse<T> {
  status: number;
  data: T;
  headers: Headers;
  /** Number of retries performed for this call. */
  retryCount: number;
  /** Number of 429 responses observed for this call. */
  rateLimitCount: number;
}

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly connectionStatus: ConnectionStatus,
    readonly code: string,
    message: string,
    readonly retryCount = 0,
    readonly rateLimitCount = 0,
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      },
      { once: true },
    );
  });
}

/** Exponential backoff with full jitter, capped at 30s. */
function backoffDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.floor(Math.random() * base);
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);

  const date = Date.parse(raw);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 120_000);
  }
  return undefined;
}

function connectionStatusForHttp(status: number): ConnectionStatus {
  if (status === 401) return "AUTH_ERROR";
  if (status === 403) return "PERMISSION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  return "API_ERROR";
}

export class ProviderHttpClient {
  private readonly baseOrigin: string;
  private readonly log;

  constructor(private readonly options: ProviderHttpOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.protocol !== "https:") {
      throw new Error(`Provider base URL must use https: ${options.baseUrl}`);
    }
    this.baseOrigin = parsed.origin;
    this.log = logger.child({ provider: options.providerSlug });
  }

  async request<T>(options: RequestOptions): Promise<ProviderResponse<T>> {
    const url = this.buildUrl(options.path, options.query);
    const maxRetries = options.maxRetries ?? this.options.maxRetries ?? serverEnv.httpMaxRetries;
    const timeoutMs = this.options.timeoutMs ?? serverEnv.httpTimeoutMs;

    let retryCount = 0;
    let rateLimitCount = 0;
    let lastError: ProviderHttpError | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

      const abortHandler = () => timeoutController.abort();
      options.signal?.addEventListener("abort", abortHandler, { once: true });

      const startedAt = Date.now();

      try {
        const response = await fetch(url, {
          method: options.method ?? "GET",
          headers: {
            accept: "application/json",
            "user-agent": serverEnv.httpUserAgent,
            ...this.options.defaultHeaders,
            ...options.headers,
            ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: timeoutController.signal,
          // Never auto-follow: a redirect could point at an internal address.
          redirect: "manual",
          cache: "no-store",
        });

        const durationMs = Date.now() - startedAt;

        if (response.status >= 300 && response.status < 400) {
          throw new ProviderHttpError(
            response.status,
            "API_ERROR",
            "UNEXPECTED_REDIRECT",
            "Provider returned an unexpected redirect; refusing to follow it.",
            retryCount,
            rateLimitCount,
          );
        }

        if (response.status === 429) rateLimitCount += 1;

        if (response.ok) {
          const data = await this.parseBody<T>(response);
          this.log.debug("provider request", {
            method: options.method ?? "GET",
            path: options.path,
            status: response.status,
            durationMs,
            attempt,
          });
          return { status: response.status, data, headers: response.headers, retryCount, rateLimitCount };
        }

        const errorText = await response.text().catch(() => "");
        const httpError = new ProviderHttpError(
          response.status,
          connectionStatusForHttp(response.status),
          `HTTP_${response.status}`,
          this.describeHttpFailure(response.status, errorText),
          retryCount,
          rateLimitCount,
        );

        // 401/403 are terminal: retrying invalid credentials forever is both
        // useless and a good way to get an account suspended.
        if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
          throw httpError;
        }

        lastError = httpError;
        const retryAfter = parseRetryAfter(response.headers);
        const delay = retryAfter ?? backoffDelayMs(attempt);

        this.log.warn("provider request retry", {
          path: options.path,
          status: response.status,
          attempt,
          delayMs: delay,
        });

        retryCount += 1;
        await sleep(delay, options.signal);
      } catch (error) {
        if (error instanceof ProviderHttpError) {
          if (attempt === maxRetries || !RETRYABLE_STATUSES.has(error.status)) throw error;
          lastError = error;
        } else {
          const aborted = options.signal?.aborted === true;
          if (aborted) {
            throw new ProviderHttpError(
              0,
              "API_ERROR",
              "ABORTED",
              "Request was cancelled.",
              retryCount,
              rateLimitCount,
            );
          }

          const networkError = new ProviderHttpError(
            0,
            "API_ERROR",
            "NETWORK_ERROR",
            `Could not reach the provider API: ${sanitizeErrorMessage(error, 160)}`,
            retryCount,
            rateLimitCount,
          );

          if (attempt === maxRetries) throw networkError;
          lastError = networkError;
          retryCount += 1;
          await sleep(backoffDelayMs(attempt), options.signal);
        }
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abortHandler);
      }
    }

    throw (
      lastError ??
      new ProviderHttpError(0, "API_ERROR", "UNKNOWN", "Request failed.", retryCount, rateLimitCount)
    );
  }

  private async parseBody<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderHttpError(
        response.status,
        "API_ERROR",
        "MALFORMED_RESPONSE",
        "Provider returned a response that was not valid JSON.",
      );
    }
  }

  private describeHttpFailure(status: number, _body: string): string {
    // The provider body may echo request details, so it is never surfaced.
    switch (status) {
      case 400:
        return "The provider rejected the request as malformed.";
      case 401:
        return "Authentication failed. The stored credentials were not accepted.";
      case 403:
        return "The credentials are valid but lack permission for this API.";
      case 404:
        return "The requested provider resource does not exist or is not visible to this account.";
      case 429:
        return "The provider rate limit was exceeded.";
      default:
        return status >= 500
          ? `The provider API is unavailable (HTTP ${status}).`
          : `The provider API returned HTTP ${status}.`;
    }
  }

  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const url = new URL(path, this.options.baseUrl);

    // Defence in depth: a path such as "//evil.example.com/x" or an absolute
    // URL would otherwise escape the trusted origin.
    if (url.origin !== this.baseOrigin) {
      throw new ProviderHttpError(
        0,
        "API_ERROR",
        "INVALID_URL",
        "Refusing to call a host outside the provider's own API origin.",
      );
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }
}

export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}
