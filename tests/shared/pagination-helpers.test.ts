import { describe, expect, test } from "vitest";
import { formatPaginatedResult } from "../../src/shared/pagination-helpers.js";
import type { PancakeListResponse } from "../../src/shared/schemas.js";

describe("formatPaginatedResult - aggs preservation", () => {
  test("returns aggs when present", () => {
    const response: PancakeListResponse<{ id: number }> = {
      data: [{ id: 1 }],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 100,
      total_pages: 100,
      aggs: {
        cod: { value: 12345 },
        status: { buckets: [{ key: "0", doc_count: 50 }] },
      },
    };
    const r = formatPaginatedResult(response);
    expect(r.aggs).toBeDefined();
    expect(r.aggs?.cod).toEqual({ value: 12345 });
    expect(r.aggs?.status).toEqual({ buckets: [{ key: "0", doc_count: 50 }] });
  });

  test("omits aggs key when not in response", () => {
    const response: PancakeListResponse<{ id: number }> = {
      data: [],
      success: true,
      page_number: 1,
      page_size: 30,
      total_entries: 0,
      total_pages: 0,
    };
    const r = formatPaginatedResult(response);
    expect("aggs" in r).toBe(false);
  });

  test("data + pagination still present alongside aggs", () => {
    const response: PancakeListResponse<{ id: number }> = {
      data: [{ id: 1 }, { id: 2 }],
      success: true,
      page_number: 2,
      page_size: 10,
      total_entries: 50,
      total_pages: 5,
      aggs: { cod: { value: 1 } },
    };
    const r = formatPaginatedResult(response);
    expect(r.data).toEqual([{ id: 1 }, { id: 2 }]);
    expect(r.pagination).toEqual({
      page: 2,
      pageSize: 10,
      total: 50,
      totalPages: 5,
    });
  });

  test("backward compat: consumers expecting {data, pagination} shape still work", () => {
    const response: PancakeListResponse<{ id: number }> = {
      data: [{ id: 1 }],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 1,
      total_pages: 1,
    };
    const r = formatPaginatedResult(response);
    const consumed: { data: { id: number }[] } = r;
    expect(consumed.data).toHaveLength(1);
  });
});
