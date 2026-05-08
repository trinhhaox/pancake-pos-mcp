import { describe, expect, test } from "vitest";
import { project } from "../../src/shared/response-projection.js";
import fullOrderResp from "../fixtures/orders-get-full-response.json";

const fullOrder = (fullOrderResp as { data: Record<string, unknown> }).data;

describe("project()", () => {
  test("returns data unchanged when verbosity=full", () => {
    expect(project(fullOrder, "id,system_id", "full")).toEqual(fullOrder);
  });

  test("strips fields not in mask when verbosity=compact", () => {
    const out = project(fullOrder, "id,system_id,total_price", "compact") as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["id", "system_id", "total_price"]);
  });

  test("preserves nested array structure with items() syntax", () => {
    const out = project(fullOrder, "items(id,quantity)", "compact") as { items: Record<string, unknown>[] };
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items.length).toBeGreaterThan(0);
    for (const it of out.items) {
      expect(Object.keys(it).sort()).toEqual(["id", "quantity"]);
    }
  });

  test("default verbosity is compact", () => {
    const out = project(fullOrder, "id") as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["id"]);
  });

  test("returns under 25% of original size for typical mask", () => {
    const fullSize = JSON.stringify(fullOrder).length;
    const compactSize = JSON.stringify(
      project(fullOrder, "id,system_id,total_price,items(id,quantity)"),
    ).length;
    expect(compactSize / fullSize).toBeLessThan(0.25);
  });

  test("handles null data gracefully", () => {
    expect(project(null, "id", "compact")).toBeNull();
  });

  test("handles undefined data gracefully", () => {
    expect(project(undefined, "id", "compact")).toBeUndefined();
  });

  test("handles array root by mapping mask over each element", () => {
    const arr = [fullOrder, fullOrder];
    const out = project(arr, "id", "compact") as Record<string, unknown>[];
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(2);
    for (const o of out) {
      expect(Object.keys(o)).toEqual(["id"]);
    }
  });
});
