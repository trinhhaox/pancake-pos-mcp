import { describe, expect, test } from "vitest";
import { buildQueryParams, buildRequestUrl } from "../../src/api-client/request-builder.js";

describe("buildQueryParams - array serialization", () => {
  test("single-value array → key[]=v", () => {
    const sp = buildQueryParams({ fields: ["id"] });
    expect(sp.getAll("fields[]")).toEqual(["id"]);
  });

  test("multi-value array → repeated key[]", () => {
    const sp = buildQueryParams({ fields: ["id", "total"] });
    expect(sp.getAll("fields[]")).toEqual(["id", "total"]);
  });

  test("number array (filter_status)", () => {
    const sp = buildQueryParams({ filter_status: [0, 1] });
    expect(sp.getAll("filter_status[]")).toEqual(["0", "1"]);
  });

  test("empty array → omitted entirely", () => {
    const sp = buildQueryParams({ fields: [] });
    expect(sp.has("fields[]")).toBe(false);
    expect(sp.has("fields")).toBe(false);
  });

  test("mixed scalar + array in same call", () => {
    const sp = buildQueryParams({ page_size: 10, fields: ["id", "total"] });
    expect(sp.get("page_size")).toBe("10");
    expect(sp.getAll("fields[]")).toEqual(["id", "total"]);
  });

  test("undefined/null skipped, scalar preserved", () => {
    const sp = buildQueryParams({ a: undefined, b: null, c: "ok" });
    expect(sp.has("a")).toBe(false);
    expect(sp.has("b")).toBe(false);
    expect(sp.get("c")).toBe("ok");
  });

  test("nested array (order_sources) — inner array JSON-encoded", () => {
    // Pancake docs show order_sources=[["-1","314"]]; inner tuples must remain grouped.
    // Decision: stringify each inner array element as JSON so wire is order_sources[]=["-1","314"].
    const sp = buildQueryParams({ order_sources: [["-1", "314"]] });
    expect(sp.getAll("order_sources[]")).toEqual(['["-1","314"]']);
  });

  test("boolean coerced via String()", () => {
    const sp = buildQueryParams({ include_total: true });
    expect(sp.get("include_total")).toBe("true");
  });
});

describe("buildRequestUrl - integration with arrays", () => {
  test("fields[] in URL uses bracket-style, not JSON", () => {
    const url = buildRequestUrl(
      "https://pos.pages.fm/api/v1",
      "shop123",
      "key456",
      "orders",
      { fields: ["id", "total"] },
    );
    expect(url).toContain("fields%5B%5D=id");
    expect(url).toContain("fields%5B%5D=total");
    expect(url).not.toContain("fields=%5B"); // no JSON-encoded array
  });

  test("filter_status[] repeated for multi-value", () => {
    const url = buildRequestUrl(
      "https://pos.pages.fm/api/v1",
      "shop",
      "k",
      "orders",
      { filter_status: [0, 1] },
    );
    expect(url).toContain("filter_status%5B%5D=0");
    expect(url).toContain("filter_status%5B%5D=1");
  });

  test("api_key still injected", () => {
    const url = buildRequestUrl("https://x.com/v1", "s", "k", "orders", {});
    expect(url).toContain("api_key=k");
  });

  test("empty array param does not appear in URL", () => {
    const url = buildRequestUrl("https://x.com/v1", "s", "k", "orders", { fields: [] });
    expect(url).not.toContain("fields");
  });
});
