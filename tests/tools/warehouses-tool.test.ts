import { describe, it, expect, vi } from "vitest";
import {
  warehousesToolSchema,
  handleWarehousesTool,
} from "../../src/tools/warehouses-tool.js";
import type { PancakeHttpClient } from "../../src/api-client/pancake-http-client.js";
import { WAREHOUSE_COMPACT_MASK } from "../../src/shared/compact-masks.js";
import { project } from "../../src/shared/response-projection.js";

const warehousesResp = require("../fixtures/warehouses-list-full-response.json");
const sample = warehousesResp.data[0] as Record<string, unknown>;

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

describe("warehouses compact projection (Phase 4)", () => {
  it("compact keeps id, name, full_address, allow_create_order", () => {
    const out = project(sample, WAREHOUSE_COMPACT_MASK, "compact") as Record<string, unknown>;
    for (const k of ["id", "name", "full_address", "allow_create_order"]) {
      expect(out).toHaveProperty(k);
    }
  });

  it("compact strips batch_config, shelf_config, custom_*_config noise", () => {
    const out = project(sample, WAREHOUSE_COMPACT_MASK, "compact") as Record<string, unknown>;
    for (const k of [
      "batch_config",
      "shelf_config",
      "custom_batch_config",
      "custom_shelf_config",
      "hide_config_batch_shelf",
      "affiliate_shop_id",
      "country_code",
      "postcode",
    ]) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it("compact strips at least 30% bytes (test shop has empty batch/shelf configs)", () => {
    // Test shop warehouses don't populate batch_config / shelf_config / custom_*_config
    // so most field strips are null fields (already small). Production warehouses
    // with populated config blobs see much higher reduction.
    const fullBytes = JSON.stringify(sample).length;
    const compactBytes = JSON.stringify(
      project(sample, WAREHOUSE_COMPACT_MASK, "compact"),
    ).length;
    expect(compactBytes / fullBytes).toBeLessThan(0.7);
  });

  it("verbosity=full preserves raw", () => {
    expect(project(sample, WAREHOUSE_COMPACT_MASK, "full")).toEqual(sample);
  });

  it("list action returns projected array by default", async () => {
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(warehousesResp),
    });
    const parsed = warehousesToolSchema.parse({ action: "list" });
    const result = (await handleWarehousesTool(parsed, client)) as {
      data: Record<string, unknown>[];
    };
    expect(result.data.length).toBe(warehousesResp.data.length);
    for (const w of result.data) {
      expect(w).toHaveProperty("id");
      expect(w).toHaveProperty("allow_create_order");
      expect(w).not.toHaveProperty("batch_config");
    }
  });

  it("get action with verbosity=full returns raw", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: sample, success: true }),
    });
    const parsed = warehousesToolSchema.parse({
      action: "get",
      warehouse_id: sample.id as string,
      verbosity: "full",
    });
    const result = await handleWarehousesTool(parsed, client);
    expect(result).toEqual(sample);
  });

  it("preserves allow_create_order flag (critical for order creation filter)", () => {
    for (const w of warehousesResp.data) {
      const out = project(w, WAREHOUSE_COMPACT_MASK, "compact") as Record<string, unknown>;
      expect(out).toHaveProperty("allow_create_order");
      expect(out.allow_create_order).toBe(w.allow_create_order);
    }
  });
});
