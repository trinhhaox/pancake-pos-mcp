import { describe, expect, test, vi } from "vitest";
import { handleOrdersTool, ordersToolSchema } from "../../src/tools/orders-tool.js";
import { ORDER_SORT_VALUES } from "../../src/shared/sort-options.js";
import type { PancakeHttpClient } from "../../src/api-client/pancake-http-client.js";

describe("orders-tool list action — option_sort enum", () => {
  test("accepts valid enum value", () => {
    const r = ordersToolSchema.safeParse({
      action: "list",
      option_sort: "order_valuation_desc",
    });
    expect(r.success).toBe(true);
  });

  test("rejects invalid sort value", () => {
    const r = ordersToolSchema.safeParse({
      action: "list",
      option_sort: "total_desc", // not a valid Pancake value
    });
    expect(r.success).toBe(false);
  });

  test("all 18 documented values accepted", () => {
    for (const sort of ORDER_SORT_VALUES) {
      const r = ordersToolSchema.safeParse({ action: "list", option_sort: sort });
      expect(r.success, `${sort} should be valid`).toBe(true);
    }
  });

  test("optional (omittable)", () => {
    const r = ordersToolSchema.safeParse({ action: "list" });
    expect(r.success).toBe(true);
  });
});

describe("orders-tool batch_update — schema", () => {
  test("accepts valid batch with note updates", () => {
    const r = ordersToolSchema.safeParse({
      action: "batch_update",
      updates: [
        { order_id: 411, note: "Đã ck" },
        { order_id: 412, status: 1 },
      ],
    });
    expect(r.success).toBe(true);
  });

  test("rejects empty updates array", () => {
    const r = ordersToolSchema.safeParse({ action: "batch_update", updates: [] });
    expect(r.success).toBe(false);
  });

  test("rejects more than 50 updates", () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({ order_id: i + 1, note: "x" }));
    const r = ordersToolSchema.safeParse({ action: "batch_update", updates });
    expect(r.success).toBe(false);
  });

  test("requires order_id on each item", () => {
    const r = ordersToolSchema.safeParse({
      action: "batch_update",
      updates: [{ note: "missing id" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("orders-tool batch_update — handler", () => {
  function mockClient(behaviour: (orderId: number) => Promise<unknown>) {
    return {
      put: vi.fn().mockImplementation((path: string) => {
        const id = Number(path.split("/")[1]);
        return behaviour(id);
      }),
    } as unknown as PancakeHttpClient;
  }

  test("succeeds for all orders", async () => {
    const client = mockClient((id) => Promise.resolve({ data: { id, status: 1 } }));
    const result = (await handleOrdersTool(
      {
        action: "batch_update",
        updates: [
          { order_id: 1, note: "a" },
          { order_id: 2, note: "b" },
        ],
      },
      client,
    )) as { total: number; succeeded: number; failed: number };
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  test("partial failure surfaces per-item error without aborting the batch", async () => {
    const client = mockClient((id) =>
      id === 2 ? Promise.reject(new Error("boom")) : Promise.resolve({ data: { id } }),
    );
    const result = (await handleOrdersTool(
      {
        action: "batch_update",
        updates: [
          { order_id: 1, note: "a" },
          { order_id: 2, note: "b" },
          { order_id: 3, note: "c" },
        ],
      },
      client,
    )) as {
      succeeded: number;
      failed: number;
      results: Array<{ order_id: number; ok: boolean; error?: string }>;
    };
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(1);
    const failed = result.results.find((r) => !r.ok);
    expect(failed?.order_id).toBe(2);
    expect(failed?.error).toContain("boom");
  });

  test("rejects items with no updatable fields", async () => {
    const client = mockClient(() => Promise.resolve({ data: {} }));
    const result = (await handleOrdersTool(
      {
        action: "batch_update",
        updates: [{ order_id: 99 }],
      },
      client,
    )) as { failed: number; results: Array<{ ok: boolean; error?: string }> };
    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toMatch(/at least one updatable field/);
  });
});
