import { z } from "zod";

// Pagination parameters used across all list endpoints
export const PaginationParams = z.object({
  page_number: z.coerce.number().int().positive().optional().describe("Page number (default 1)"),
  page_size: z.coerce.number().int().min(1).max(200).optional().describe("Items per page (default 30, max 200)"),
});

// Date range filter for order/transaction queries
export const DateRangeParams = z.object({
  startDateTime: z.coerce.number().int().optional().describe("Start date as unix timestamp"),
  endDateTime: z.coerce.number().int().optional().describe("End date as unix timestamp"),
});

// Server-side Elasticsearch aggregations attached to list responses.
// Shape varies per endpoint: orders expose cod/partner_fee/prepaid/shipping_fee
// (sum metrics) plus status/tag (term buckets). Type kept flexible — callers
// access by string key.
export type PancakeAggregationValue =
  | { value: number }
  | { buckets: Array<{ key: string; doc_count: number }> | null; doc_count?: number };

export type PancakeAggregations = Record<string, PancakeAggregationValue>;

// Standard paginated response from Pancake API
export interface PancakeListResponse<T> {
  data: T[];
  success: boolean;
  page_number: number;
  page_size: number;
  total_entries: number;
  total_pages: number;
  aggs?: PancakeAggregations;
}

// Standard single-item response from Pancake API
export interface PancakeResponse<T> {
  data: T;
  success: boolean;
}

// Pagination metadata returned in tool results
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Vietnam address schema — supports both OLD (3-tier, pre-2025-07-01) and NEW
// (2-tier, post-2025-07-01 administrative reform) formats simultaneously.
// All fields optional — callsites use `.extend({...})` to mark required fields
// (e.g. full_name on Create actions). Cross-field validation (at least one
// location anchor present) lives in handler layer, not Zod.
export const VietnamAddressSchema = z.object({
  full_name: z.string().optional(),
  phone_number: z.string().optional(),
  address: z.string().optional().describe("Street address (house number, street name)"),
  country_code: z.coerce.number().optional().describe("Country code, default 84 for Vietnam"),
  // OLD format (pre-2025-07-01, 3-tier: province → district → commune)
  province_id: z.string().optional().describe("OLD format province ID (e.g. '701')"),
  district_id: z.string().optional().describe("OLD format district ID (3-tier only)"),
  commune_id: z.string().optional().describe("OLD format commune/ward ID (3-tier only)"),
  // NEW format (post-2025-07-01, 2-tier: province → commune; district level removed)
  new_province_id: z.string().optional().describe("NEW format province ID (e.g. '84_VN129')"),
  new_commune_id: z.string().optional().describe("NEW format commune/ward ID (no district level)"),
  new_full_address: z.string().optional().describe("NEW format pre-formatted full address"),
});

export type VietnamAddress = z.infer<typeof VietnamAddressSchema>;
