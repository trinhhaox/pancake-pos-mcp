import type { PancakeConfig } from "../config.js";
import type { PancakeListResponse, PancakeResponse } from "../shared/schemas.js";
import { PancakeApiError } from "../shared/error-handler.js";
import { buildRequestUrl, redactUrl } from "./request-builder.js";
import { parseResponse, parsePaginatedResponse } from "./response-parser.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export interface HttpClientOptions {
  /** Request timeout in ms. Default: 30_000 (Bun). Use 8_000 for Workers. */
  fetchTimeoutMs?: number;
  /** Max retry attempts. Default: 3 (Bun). Use 2 for Workers. */
  maxRetries?: number;
  /** Enable token-bucket rate limiter. Default: true. Disable for Workers (stateless resets make it useless). */
  enableRateLimiter?: boolean;
}

/**
 * HTTP client for the Pancake POS API.
 * Handles auth injection, token-bucket rate limiting, and exponential backoff retry.
 */
export class PancakeHttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly shopId: string;

  // Configurable per-deployment options
  private readonly fetchTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly enableRateLimiter: boolean;

  // Per-minute token bucket: 1000 tokens/min
  private minuteTokens = 1000;
  private readonly maxMinuteTokens = 1000;
  private lastMinuteRefill = Date.now();
  private readonly minuteRefillRateMs = 60; // 1 token every 60ms = 1000/min

  // Per-hour token bucket: 10000 tokens/hour
  private hourTokens = 10000;
  private readonly maxHourTokens = 10000;
  private lastHourRefill = Date.now();
  private readonly hourRefillRateMs = 360; // 1 token every 360ms = 10000/hour

  // Pancake POS requires BOTH the api_key query param (for shop-scoped
  // routing) AND an `Authorization: Bearer <apiKey>` header (many endpoints
  // such as orders/products/customers reject requests with only api_key via
  // "Missing access_token"). Send both on every request.
  private readonly authHeaders: Record<string, string>;

  constructor(config: PancakeConfig, options?: HttpClientOptions) {
    this.baseUrl = config.PANCAKE_POS_BASE_URL;
    this.apiKey = config.PANCAKE_POS_API_KEY;
    this.shopId = config.PANCAKE_POS_SHOP_ID;
    this.authHeaders = { Authorization: `Bearer ${this.apiKey}` };
    this.fetchTimeoutMs = options?.fetchTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.enableRateLimiter = options?.enableRateLimiter ?? true;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<PancakeResponse<T>> {
    const url = buildRequestUrl(this.baseUrl, this.shopId, this.apiKey, path, params);
    const response = await this.executeWithRetry(url, { method: "GET", headers: this.authHeaders });
    return parseResponse<T>(response);
  }

  async getList<T>(path: string, params?: Record<string, unknown>): Promise<PancakeListResponse<T>> {
    const url = buildRequestUrl(this.baseUrl, this.shopId, this.apiKey, path, params);
    const response = await this.executeWithRetry(url, { method: "GET", headers: this.authHeaders });
    return parsePaginatedResponse<T>(response);
  }

  async post<T>(path: string, body?: unknown): Promise<PancakeResponse<T>> {
    const url = buildRequestUrl(this.baseUrl, this.shopId, this.apiKey, path);
    const response = await this.executeWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.authHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseResponse<T>(response);
  }

  async put<T>(path: string, body?: unknown): Promise<PancakeResponse<T>> {
    const url = buildRequestUrl(this.baseUrl, this.shopId, this.apiKey, path);
    const response = await this.executeWithRetry(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...this.authHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
    return parseResponse<T>(response);
  }

  async delete(path: string): Promise<PancakeResponse<void>> {
    const url = buildRequestUrl(this.baseUrl, this.shopId, this.apiKey, path);
    const response = await this.executeWithRetry(url, { method: "DELETE", headers: this.authHeaders });
    return parseResponse<void>(response);
  }

  private async executeWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await this.consumeToken();

      try {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.timeout(this.fetchTimeoutMs),
        });

        // Retry on 5xx errors or 429 Too Many Requests
        const shouldRetry =
          (response.status >= 500 || response.status === 429) &&
          attempt < this.maxRetries - 1;

        if (shouldRetry) {
          let delay = RETRY_BASE_MS * Math.pow(2, attempt);

          // Honour Retry-After header for 429 responses
          if (response.status === 429) {
            const retryAfter = response.headers.get("retry-after");
            if (retryAfter) {
              const retryAfterMs = Number(retryAfter) * 1000;
              if (!isNaN(retryAfterMs) && retryAfterMs > 0) {
                delay = Math.min(retryAfterMs, this.fetchTimeoutMs);
              }
            }
          }

          console.error(
            `[PancakeHTTP] ${response.status} on ${redactUrl(url)}, retrying in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`,
          );
          await sleep(delay);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.maxRetries - 1) {
          const delay = RETRY_BASE_MS * Math.pow(2, attempt);
          console.error(
            `[PancakeHTTP] Network error on ${redactUrl(url)}, retrying in ${delay}ms: ${lastError.message}`,
          );
          await sleep(delay);
        }
      }
    }

    throw new PancakeApiError(
      "NETWORK_ERROR",
      `Failed after ${this.maxRetries} retries: ${lastError?.message}`,
      0,
    );
  }

  /**
   * Async token bucket rate limiter. Waits if no tokens available.
   * Skipped when enableRateLimiter is false (Workers mode).
   */
  private async consumeToken(): Promise<void> {
    if (!this.enableRateLimiter) return;

    this.refillTokens();

    while (this.minuteTokens <= 0 || this.hourTokens <= 0) {
      const waitMs = this.minuteTokens <= 0 ? this.minuteRefillRateMs : this.hourRefillRateMs;
      console.error(`[PancakeHTTP] Rate limit reached, waiting ${waitMs}ms`);
      await sleep(waitMs);
      this.refillTokens();
    }

    this.minuteTokens--;
    this.hourTokens--;
  }

  private refillTokens(): void {
    const now = Date.now();

    const minuteElapsed = now - this.lastMinuteRefill;
    const minuteToAdd = Math.floor(minuteElapsed / this.minuteRefillRateMs);
    if (minuteToAdd > 0) {
      this.minuteTokens = Math.min(this.maxMinuteTokens, this.minuteTokens + minuteToAdd);
      this.lastMinuteRefill = now;
    }

    const hourElapsed = now - this.lastHourRefill;
    const hourToAdd = Math.floor(hourElapsed / this.hourRefillRateMs);
    if (hourToAdd > 0) {
      this.hourTokens = Math.min(this.maxHourTokens, this.hourTokens + hourToAdd);
      this.lastHourRefill = now;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
