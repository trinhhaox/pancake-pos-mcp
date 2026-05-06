import type { PancakeAggregations, PancakeListResponse, PaginationMeta } from "./schemas.js";

/**
 * Extract pagination metadata from a Pancake list response.
 */
export function extractPagination(response: PancakeListResponse<unknown>): PaginationMeta {
  return {
    page: response.page_number,
    pageSize: response.page_size,
    total: response.total_entries,
    totalPages: response.total_pages,
  };
}

/**
 * Format a paginated tool result with data + pagination info.
 * `aggs` (Elasticsearch server-side aggregations) is forwarded when present so
 * callers can answer revenue/count queries without paginating.
 */
export function formatPaginatedResult<T>(response: PancakeListResponse<T>): {
  data: T[];
  pagination: PaginationMeta;
  aggs?: PancakeAggregations;
} {
  const result: { data: T[]; pagination: PaginationMeta; aggs?: PancakeAggregations } = {
    data: response.data,
    pagination: extractPagination(response),
  };
  if (response.aggs) result.aggs = response.aggs;
  return result;
}
