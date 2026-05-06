import { describe, expect, test, vi } from "vitest";
import { analyticsToolSchema, handleAnalyticsTool } from "../../src/tools/analytics-tool.js";

function mockClient(response: Record<string, unknown>) {
  return {
    getList: vi.fn().mockResolvedValue(response),
  };
}

describe("analyticsToolSchema validation", () => {
  test("rejects invalid metric", () => {
    const r = analyticsToolSchema.safeParse({
      action: "top_orders",
      metric: "popularity",
      limit: 5,
    });
    expect(r.success).toBe(false);
  });

  test("top_orders defaults metric=total_price + limit=10", () => {
    const r = analyticsToolSchema.safeParse({ action: "top_orders" });
    expect(r.success).toBe(true);
    if (r.success && r.data.action === "top_orders") {
      expect(r.data.metric).toBe("total_price");
      expect(r.data.limit).toBe(10);
    }
  });

  test("revenue_summary requires startDateTime + endDateTime", () => {
    const r = analyticsToolSchema.safeParse({ action: "revenue_summary" });
    expect(r.success).toBe(false);
  });

  test("revenue_summary accepts required dates", () => {
    const r = analyticsToolSchema.safeParse({
      action: "revenue_summary",
      startDateTime: 1700000000,
      endDateTime: 1730000000,
    });
    expect(r.success).toBe(true);
  });
});

describe("top_orders handler", () => {
  test("metric=total_price → option_sort=order_valuation_desc + correct limit", async () => {
    const client = mockClient({
      data: [{ id: 1, total_price: 999 }],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 1,
      total_pages: 1,
    });
    await handleAnalyticsTool(
      { action: "top_orders", metric: "total_price", limit: 1 },
      client,
    );
    expect(client.getList).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        option_sort: "order_valuation_desc",
        page_size: 1,
        page_number: 1,
      }),
    );
  });

  test("metric=total_quantity → product_quantity_desc", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 5,
      total_entries: 0,
      total_pages: 0,
    });
    await handleAnalyticsTool(
      { action: "top_orders", metric: "total_quantity", limit: 5 },
      client,
    );
    expect(client.getList).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({ option_sort: "product_quantity_desc" }),
    );
  });

  test("default fields applied when not given (no items_length — not a Pancake field)", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 10,
      total_entries: 0,
      total_pages: 0,
    });
    await handleAnalyticsTool({ action: "top_orders", metric: "total_price", limit: 10 }, client);
    const call = client.getList.mock.calls[0]![1] as Record<string, unknown>;
    expect(call.fields).toEqual([
      "id",
      "total_price",
      "inserted_at",
      "bill_full_name",
    ]);
  });

  test("forwards date range and status filter", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 3,
      total_entries: 0,
      total_pages: 0,
    });
    await handleAnalyticsTool(
      {
        action: "top_orders",
        metric: "total_price",
        limit: 3,
        startDateTime: 1700000000,
        endDateTime: 1730000000,
        filter_status: [3],
      },
      client,
    );
    expect(client.getList).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        startDateTime: 1700000000,
        endDateTime: 1730000000,
        filter_status: [3],
      }),
    );
  });

  test("returns formatted paginated result", async () => {
    const client = mockClient({
      data: [{ id: 42, total_price: 9_999_000 }],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 280,
      total_pages: 280,
    });
    const r = (await handleAnalyticsTool(
      { action: "top_orders", metric: "total_price", limit: 1 },
      client,
    )) as { data: unknown[]; pagination: { total: number } };
    expect(r.data).toEqual([{ id: 42, total_price: 9_999_000 }]);
    expect(r.pagination.total).toBe(280);
  });
});

describe("revenue_summary handler", () => {
  test("extracts aggs into named fields", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 280,
      total_pages: 280,
      aggs: {
        cod: { value: 4.55e8 },
        shipping_fee: { value: 1.78e7 },
        prepaid: { value: 4.3e5 },
        partner_fee: { value: 1.0e5 },
        status: { buckets: [{ key: "3", doc_count: 111 }] },
      },
    });
    const r = (await handleAnalyticsTool(
      {
        action: "revenue_summary",
        startDateTime: 1700000000,
        endDateTime: 1730000000,
      },
      client,
    )) as Record<string, unknown>;
    expect(r.revenue_cod).toBe(4.55e8);
    expect(r.shipping_fee).toBe(1.78e7);
    expect(r.prepaid).toBe(4.3e5);
    expect(r.partner_fee).toBe(1.0e5);
    expect(r.total_orders).toBe(280);
    expect(r.status_breakdown).toEqual([{ key: "3", doc_count: 111 }]);
    expect(r.currency).toBe("VND");
  });

  test("zero values + warning when aggs missing", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 0,
      total_pages: 0,
    });
    const r = (await handleAnalyticsTool(
      { action: "revenue_summary", startDateTime: 0, endDateTime: 1 },
      client,
    )) as Record<string, unknown>;
    expect(r.revenue_cod).toBe(0);
    expect(r.shipping_fee).toBe(0);
    expect(r.status_breakdown).toEqual([]);
    expect(r.aggs_available).toBe(false);
    expect((r.warnings as string[]).length).toBeGreaterThan(0);
  });

  test("rejects NaN / non-finite values (treats as null, sets warning)", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 5,
      total_pages: 5,
      aggs: {
        cod: { value: Number.NaN },
        prepaid: { value: Infinity },
      },
    });
    const r = (await handleAnalyticsTool(
      { action: "revenue_summary", startDateTime: 0, endDateTime: 1 },
      client,
    )) as Record<string, unknown>;
    expect(r.revenue_cod).toBe(0);
    expect(r.prepaid).toBe(0);
    expect(r.aggs_available).toBe(true);
    expect((r.warnings as string[]).length).toBeGreaterThan(0);
  });

  test("requests page_size=1 + minimal fields to skip data payload", async () => {
    const client = mockClient({
      data: [],
      success: true,
      page_number: 1,
      page_size: 1,
      total_entries: 0,
      total_pages: 0,
    });
    await handleAnalyticsTool(
      { action: "revenue_summary", startDateTime: 0, endDateTime: 1 },
      client,
    );
    expect(client.getList).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({ page_size: 1, fields: ["id"] }),
    );
  });
});
