import { describe, it, expect, vi } from "vitest";
import {
  productsToolSchema,
  handleProductsTool,
} from "../../src/tools/products-tool.js";
import type { PancakeHttpClient } from "../../src/api-client/pancake-http-client.js";
import {
  PRODUCT_COMPACT_MASK,
  PRODUCT_VARIATIONS_MASK,
} from "../../src/shared/compact-masks.js";
import { project } from "../../src/shared/response-projection.js";

const productsListResp = require("../fixtures/products-list-full-response.json");
const productGetResp = require("../fixtures/products-get-full-response.json");
const sampleProduct = productsListResp.data[0] as Record<string, unknown>;
const fullProduct = productGetResp.data as Record<string, unknown>;

function mockClient(overrides: Partial<PancakeHttpClient> = {}): PancakeHttpClient {
  return {
    get: vi.fn(),
    getRaw: vi.fn(),
    getList: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as PancakeHttpClient;
}

describe("products compact projection (Phase 3)", () => {
  it("compact list product keeps id, name, variations", () => {
    const out = project(sampleProduct, PRODUCT_COMPACT_MASK, "compact") as Record<string, unknown>;
    expect(out.id).toBe(sampleProduct.id);
    expect(out.name).toBe(sampleProduct.name);
    expect(Array.isArray(out.variations)).toBe(true);
  });

  it("compact variation keeps essential fields", () => {
    const out = project(sampleProduct, PRODUCT_COMPACT_MASK, "compact") as {
      variations: Record<string, unknown>[];
    };
    expect(out.variations.length).toBeGreaterThan(0);
    const v = out.variations[0]!;
    for (const k of ["id", "display_id", "retail_price", "remain_quantity"]) {
      expect(v).toHaveProperty(k);
    }
    const sampleV = (sampleProduct.variations as Record<string, unknown>[])[0]!;
    if (sampleV.fields) expect(v).toHaveProperty("fields");
    if (
      Array.isArray(sampleV.variations_warehouses) &&
      sampleV.variations_warehouses.length > 0
    ) {
      const vw = (v.variations_warehouses as Record<string, unknown>[])[0]!;
      for (const k of ["warehouse_id", "remain_quantity", "total_quantity"]) {
        expect(vw).toHaveProperty(k);
      }
    }
  });

  it("compact strips images, SEO, audit timestamps", () => {
    const out = project(sampleProduct, PRODUCT_COMPACT_MASK, "compact") as Record<string, unknown>;
    for (const k of ["image", "seo", "inserted_at", "updated_at", "note"]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("compact size <= 40% of full (test shop has lean product fixtures)", () => {
    // Test shop product is minimal (1 variation, 1 warehouse, no rich description).
    // Production shops with more variations/warehouses see better reduction.
    // Phase 6 replay validates real-world ratio against acceptance gate.
    const fullBytes = JSON.stringify(sampleProduct).length;
    const compactBytes = JSON.stringify(
      project(sampleProduct, PRODUCT_COMPACT_MASK, "compact"),
    ).length;
    expect(compactBytes / fullBytes).toBeLessThan(0.4);
  });

  it("verbosity=full preserves raw", () => {
    const out = project(fullProduct, PRODUCT_COMPACT_MASK, "full");
    expect(out).toEqual(fullProduct);
  });

  it("variations-only mask returns flat shape", () => {
    const variations = (fullProduct.variations as Record<string, unknown>[]) ?? [];
    if (variations.length > 0) {
      const out = project(variations[0]!, PRODUCT_VARIATIONS_MASK, "compact") as Record<
        string,
        unknown
      >;
      expect(out).toHaveProperty("id");
      expect(out).toHaveProperty("retail_price");
    }
  });

  it("get action returns projected response by default", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: fullProduct, success: true }),
    });
    const parsed = productsToolSchema.parse({
      action: "get",
      product_id: fullProduct.id as string,
    });
    const result = (await handleProductsTool(parsed, client)) as Record<string, unknown>;
    expect(result).toHaveProperty("id");
    expect(result).not.toHaveProperty("inserted_at");
  });

  it("get action with verbosity=full returns raw", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: fullProduct, success: true }),
    });
    const parsed = productsToolSchema.parse({
      action: "get",
      product_id: fullProduct.id as string,
      verbosity: "full",
    });
    const result = await handleProductsTool(parsed, client);
    expect(result).toEqual(fullProduct);
  });

  it("list_variations returns projected array", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: fullProduct, success: true }),
    });
    const parsed = productsToolSchema.parse({
      action: "list_variations",
      product_id: fullProduct.id as string,
    });
    const result = (await handleProductsTool(parsed, client)) as {
      data: Record<string, unknown>[];
    };
    expect(Array.isArray(result.data)).toBe(true);
    if (result.data.length > 0) {
      const v = result.data[0]!;
      expect(v).toHaveProperty("id");
      // raw variation has inserted_at, projected should not
      expect(v).not.toHaveProperty("inserted_at");
    }
  });
});
