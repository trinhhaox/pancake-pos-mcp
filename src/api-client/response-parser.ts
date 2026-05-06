import { PancakeApiError } from "../shared/error-handler.js";
import type { PancakeAggregations, PancakeListResponse, PancakeResponse } from "../shared/schemas.js";

/**
 * Parse a Pancake API response, extracting data and handling errors.
 */
export async function parseResponse<T>(response: Response): Promise<PancakeResponse<T>> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const code = mapHttpStatusToCode(response.status);
    throw new PancakeApiError(code, `API error ${response.status}: ${body || response.statusText}`, response.status);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (json.success === false) {
    const errorInfo = (json.error as Record<string, string>) || {};
    throw new PancakeApiError(
      errorInfo.code || "API_ERROR",
      errorInfo.message || "Unknown API error",
      response.status,
    );
  }

  return json as unknown as PancakeResponse<T>;
}

/**
 * Parse a paginated Pancake API response.
 */
export async function parsePaginatedResponse<T>(response: Response): Promise<PancakeListResponse<T>> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const code = mapHttpStatusToCode(response.status);
    throw new PancakeApiError(code, `API error ${response.status}: ${body || response.statusText}`, response.status);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (json.success === false) {
    const errorInfo = (json.error as Record<string, string>) || {};
    throw new PancakeApiError(
      errorInfo.code || "API_ERROR",
      errorInfo.message || "Unknown API error",
      response.status,
    );
  }

  const result: PancakeListResponse<T> = {
    data: (json.data ?? []) as T[],
    success: true,
    page_number: (json.page_number as number) ?? 1,
    page_size: (json.page_size as number) ?? 30,
    total_entries: (json.total_entries as number) ?? 0,
    total_pages: (json.total_pages as number) ?? 0,
  };
  if (json.aggs && typeof json.aggs === "object") {
    result.aggs = json.aggs as PancakeAggregations;
  }
  return result;
}

function mapHttpStatusToCode(status: number): string {
  switch (status) {
    case 400: return "BAD_REQUEST";
    case 401: return "UNAUTHORIZED";
    case 403: return "FORBIDDEN";
    case 404: return "NOT_FOUND";
    case 429: return "RATE_LIMITED";
    default: return status >= 500 ? "SERVER_ERROR" : "HTTP_ERROR";
  }
}
