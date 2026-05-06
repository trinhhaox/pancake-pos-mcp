import { describe, expect, test } from "vitest";
import { ordersToolSchema } from "../../src/tools/orders-tool.js";
import { ORDER_SORT_VALUES } from "../../src/shared/sort-options.js";

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
