import { describe, it, expect, vi } from "vitest";
import {
  ordersToolSchema,
  handleOrdersTool,
  type OrdersToolInput,
} from "../src/tools/orders-tool.js";
import type { PancakeHttpClient } from "../src/api-client/pancake-http-client.js";

function mockClient(overrides: Partial<PancakeHttpClient> = {}): PancakeHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ data: { id: 1 }, success: true }),
    getRaw: vi.fn(),
    getList: vi.fn(),
    post: vi.fn().mockResolvedValue({ data: { id: 999 }, success: true }),
    put: vi.fn().mockResolvedValue({ data: { id: 1 }, success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as unknown as PancakeHttpClient;
}

const baseCreate = {
  action: "create" as const,
  bill_full_name: "X",
  bill_phone_number: "0900000000",
  warehouse_id: "wh-1",
  items: [{ quantity: 1, variation_id: "v1", product_id: "p1" }],
};

describe("ordersToolSchema — Phase 2 address shape", () => {
  it("Create: NEW format only (no district) parses", () => {
    const input: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "45 Tran Hung Dao",
        new_province_id: "84_VN129",
        new_commune_id: "84_VN129_001",
      },
    };
    expect(ordersToolSchema.safeParse(input).success).toBe(true);
  });

  it("Create: OLD format parses", () => {
    const input: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "45 Tran Hung Dao",
        province_id: "701",
        district_id: "70101",
        commune_id: "7010101",
      },
    };
    expect(ordersToolSchema.safeParse(input).success).toBe(true);
  });

  it("Create: shipping_address missing required contact (full_name) rejected", () => {
    const input = {
      ...baseCreate,
      shipping_address: {
        phone_number: "0900000000",
        address: "x",
        province_id: "701",
      },
    };
    expect(ordersToolSchema.safeParse(input).success).toBe(false);
  });

  it("Update: shipping_address with only new_full_address parses (no anchor required at schema level)", () => {
    const input: OrdersToolInput = {
      action: "update",
      order_id: 361,
      shipping_address: { new_full_address: "abc, HCM" },
    };
    expect(ordersToolSchema.safeParse(input).success).toBe(true);
  });

  it("Update: pure contact change (phone_number only) parses", () => {
    const input: OrdersToolInput = {
      action: "update",
      order_id: 361,
      shipping_address: { phone_number: "0911111111" },
    };
    expect(ordersToolSchema.safeParse(input).success).toBe(true);
  });
});

describe("handleOrdersTool — create address validation", () => {
  it("Create with no location anchors throws", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
      },
    };
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/province_id/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("Create OLD format calls client.post with body", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
        province_id: "701",
        district_id: "70101",
        commune_id: "7010101",
      },
    };
    await handleOrdersTool(args, client);
    expect(client.post).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        shipping_address: expect.objectContaining({ province_id: "701" }),
      }),
    );
  });

  it("Create NEW format calls client.post with new_* fields", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
        new_province_id: "84_VN129",
        new_commune_id: "84_VN129_001",
      },
    };
    await handleOrdersTool(args, client);
    expect(client.post).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        shipping_address: expect.objectContaining({
          new_province_id: "84_VN129",
          new_commune_id: "84_VN129_001",
        }),
      }),
    );
  });
});

describe("handleOrdersTool — update address validation", () => {
  it("Update with only phone_number (no location) bypasses check, calls put", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      action: "update",
      order_id: 361,
      shipping_address: { phone_number: "0911111111" },
    };
    await handleOrdersTool(args, client);
    expect(client.put).toHaveBeenCalledWith(
      "orders/361",
      expect.objectContaining({
        shipping_address: { phone_number: "0911111111" },
      }),
    );
  });

  it("Update with district_id only (location sent but no province anchor) throws", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      action: "update",
      order_id: 361,
      shipping_address: { district_id: "70101" },
    };
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/province_id/);
    expect(client.put).not.toHaveBeenCalled();
  });

  it("Update with NEW format anchors calls put with new_* fields", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      action: "update",
      order_id: 361,
      shipping_address: {
        new_province_id: "84_VN129",
        new_commune_id: "84_VN129_001",
      },
    };
    await handleOrdersTool(args, client);
    expect(client.put).toHaveBeenCalledWith(
      "orders/361",
      expect.objectContaining({
        shipping_address: expect.objectContaining({
          new_province_id: "84_VN129",
          new_commune_id: "84_VN129_001",
        }),
      }),
    );
  });

  it("Schema preserves financial fields through parse", () => {
    const input = {
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
      partner_fee: 5000,
      is_free_shipping: true,
      total_discount: 1000,
      surcharge: 500,
      note_print: "Print me",
      received_at_shop: true,
      custom_id: "ABC",
      bill_email: "x@y.com",
    };
    const parsed = ordersToolSchema.parse(input);
    expect(parsed).toMatchObject({
      shipping_fee: 99000,
      partner_fee: 5000,
      is_free_shipping: true,
      total_discount: 1000,
      surcharge: 500,
      note_print: "Print me",
      received_at_shop: true,
      custom_id: "ABC",
      bill_email: "x@y.com",
    });
  });

  it("Parsed financial fields reach client.put body", async () => {
    const client = mockClient();
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
      partner_fee: 5000,
      is_free_shipping: false,
    });
    await handleOrdersTool(parsed, client);
    expect(client.put).toHaveBeenCalledWith(
      "orders/361",
      expect.objectContaining({
        shipping_fee: 99000,
        partner_fee: 5000,
        is_free_shipping: false,
      }),
    );
  });

  it("customer_pay_fee is silently dropped (Pancake api_key ignores it — verified Phase 0)", () => {
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      customer_pay_fee: true,
    });
    expect((parsed as Record<string, unknown>).customer_pay_fee).toBeUndefined();
  });

  it("verify-after-update: no fragile fields → GET not called, response identical to PUT data", async () => {
    const putData = { id: 361, note: "x" };
    const getMock = vi.fn();
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: putData, success: true }),
      get: getMock,
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      note: "x",
    });
    const result = await handleOrdersTool(parsed, client);
    expect(getMock).not.toHaveBeenCalled();
    expect(result).toEqual(putData);
    expect((result as Record<string, unknown>).warnings).toBeUndefined();
  });

  it("verify-after-update: fragile fields match → no warnings key in response", async () => {
    const putData = { id: 361, shipping_fee: 99000 };
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: putData, success: true }),
      get: vi.fn().mockResolvedValue({
        data: { id: 361, shipping_fee: 99000, partner_fee: 0, is_free_shipping: false },
        success: true,
      }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
    });
    const result = await handleOrdersTool(parsed, client);
    expect(client.get).toHaveBeenCalledWith("orders/361");
    expect((result as Record<string, unknown>).warnings).toBeUndefined();
  });

  it("verify-after-update: fragile field mismatch → warnings array with field-specific hint", async () => {
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: { id: 361, shipping_fee: 99000 }, success: true }),
      get: vi.fn().mockResolvedValue({
        data: { id: 361, shipping_fee: 83000, partner_fee: 0, is_free_shipping: false },
        success: true,
      }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
    });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    expect(Array.isArray(result.warnings)).toBe(true);
    const warnings = result.warnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/shipping_fee/);
    expect(warnings[0]).toMatch(/silently dropped/i);
    expect(warnings[0]).toMatch(/is_free_shipping/);
  });

  it("verify-after-update: multiple fragile fields, mixed match/mismatch → exactly N warnings", async () => {
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: { id: 361 }, success: true }),
      get: vi.fn().mockResolvedValue({
        data: { id: 361, shipping_fee: 0, partner_fee: 5000, is_free_shipping: true },
        success: true,
      }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
      partner_fee: 5000,
      is_free_shipping: true,
    });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    const warnings = result.warnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/shipping_fee/);
  });

  it("verify-after-update: GET throws → soft warning, PUT data still returned (no throw)", async () => {
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: { id: 361 }, success: true }),
      get: vi.fn().mockRejectedValue(new Error("network down")),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      shipping_fee: 99000,
    });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    expect(result.id).toBe(361);
    const warnings = result.warnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/verify-after-update/i);
    expect(warnings[0]).toMatch(/network down/);
  });

  it("Update items: schema accepts items array (regression: was silently stripped)", () => {
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      items: [{ quantity: 2, variation_id: "v1", product_id: "p1" }],
    }) as Record<string, unknown>;
    expect(parsed.items).toEqual([
      { quantity: 2, variation_id: "v1", product_id: "p1" },
    ]);
  });

  it("Update items: status===0 → pre-GET passes, PUT body contains items", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: { id: 361, status: 0 }, success: true }),
      put: vi.fn().mockResolvedValue({ data: { id: 361 }, success: true }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      items: [{ quantity: 3, variation_id: "v1", product_id: "p1" }],
    });
    await handleOrdersTool(parsed, client);
    expect(client.get).toHaveBeenCalledWith("orders/361");
    expect(client.put).toHaveBeenCalledWith(
      "orders/361",
      expect.objectContaining({
        items: [{ quantity: 3, variation_id: "v1", product_id: "p1" }],
      }),
    );
  });

  it("Update items: status>=1 → throws, PUT not called", async () => {
    const putMock = vi.fn();
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: { id: 361, status: 1 }, success: true }),
      put: putMock,
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      items: [{ quantity: 1, variation_id: "v1", product_id: "p1" }],
    });
    await expect(handleOrdersTool(parsed, client)).rejects.toThrow(/status 1/);
    expect(putMock).not.toHaveBeenCalled();
  });

  it("total_discount silent-drop → warning surfaced via verify-after-update", async () => {
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: { id: 361 }, success: true }),
      get: vi.fn().mockResolvedValue({
        data: { id: 361, total_discount: 0 },
        success: true,
      }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 361,
      total_discount: 50000,
    });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    const warnings = result.warnings as string[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/total_discount/);
    expect(warnings[0]).toMatch(/silently dropped/i);
    expect(warnings[0]).toMatch(/per-item discount/);
  });

  it("Update without shipping_address skips validation entirely", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      action: "update",
      order_id: 361,
      note: "updated",
    };
    await handleOrdersTool(args, client);
    expect(client.put).toHaveBeenCalledWith(
      "orders/361",
      expect.objectContaining({ note: "updated" }),
    );
  });
});

describe("orders compact projection (Phase 2)", () => {
  // Pancake CREATE/GET/UPDATE return identical record shape — reuse GET fixture.
  const fullOrderResp = require("./fixtures/orders-get-full-response.json");
  const fullOrder = fullOrderResp.data as Record<string, unknown>;

  async function loadCompactMask() {
    const m = await import("../src/shared/compact-masks.js");
    const p = await import("../src/shared/response-projection.js");
    return { ORDER_COMPACT_MASK: m.ORDER_COMPACT_MASK, project: p.project };
  }

  it("compact response contains required keys for agent reply", async () => {
    const { ORDER_COMPACT_MASK, project } = await loadCompactMask();
    const compact = project(fullOrder, ORDER_COMPACT_MASK, "compact") as Record<string, unknown>;
    for (const k of ["id", "system_id", "status", "total_price", "items", "shipping_address"]) {
      expect(compact).toHaveProperty(k);
    }
  });

  it("compact strips noise fields", async () => {
    const { ORDER_COMPACT_MASK, project } = await loadCompactMask();
    const compact = project(fullOrder, ORDER_COMPACT_MASK, "compact") as Record<string, unknown>;
    for (const k of ["p_utm_source", "assigning_care", "last_editor", "botcake_info", "marketer"]) {
      expect(compact).not.toHaveProperty(k);
    }
  });

  it("compact items[] keep only essential fields (<15 keys/item vs 50+ raw)", async () => {
    const { ORDER_COMPACT_MASK, project } = await loadCompactMask();
    const compact = project(fullOrder, ORDER_COMPACT_MASK, "compact") as { items: Record<string, unknown>[] };
    expect(Array.isArray(compact.items)).toBe(true);
    for (const it of compact.items) {
      expect(Object.keys(it).length).toBeLessThan(15);
    }
  });

  it("verbosity=full returns raw response", async () => {
    const { ORDER_COMPACT_MASK, project } = await loadCompactMask();
    const full = project(fullOrder, ORDER_COMPACT_MASK, "full");
    expect(full).toEqual(fullOrder);
  });

  it("compact size <= 25% of full", async () => {
    const { ORDER_COMPACT_MASK, project } = await loadCompactMask();
    const fullBytes = JSON.stringify(fullOrder).length;
    const compactBytes = JSON.stringify(project(fullOrder, ORDER_COMPACT_MASK, "compact")).length;
    expect(compactBytes / fullBytes).toBeLessThan(0.25);
  });

  it("get action returns projected response by default", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: fullOrder, success: true }),
    });
    const parsed = ordersToolSchema.parse({ action: "get", order_id: 480 });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    expect(result).toHaveProperty("id");
    expect(result).not.toHaveProperty("p_utm_source");
    expect(result).not.toHaveProperty("assigning_care");
  });

  it("get action with verbosity=full returns raw response", async () => {
    const client = mockClient({
      get: vi.fn().mockResolvedValue({ data: fullOrder, success: true }),
    });
    const parsed = ordersToolSchema.parse({ action: "get", order_id: 480, verbosity: "full" });
    const result = await handleOrdersTool(parsed, client);
    expect(result).toEqual(fullOrder);
  });

  it("update fragile-field warnings still detected with compact projection", async () => {
    // verify GET must remain raw so silent-drop comparison works.
    const client = mockClient({
      put: vi.fn().mockResolvedValue({ data: fullOrder, success: true }),
      get: vi.fn().mockResolvedValue({
        data: { ...fullOrder, total_discount: 0 },
        success: true,
      }),
    });
    const parsed = ordersToolSchema.parse({
      action: "update",
      order_id: 480,
      total_discount: 50000,
    });
    const result = (await handleOrdersTool(parsed, client)) as Record<string, unknown>;
    expect(result.warnings).toBeDefined();
    expect((result.warnings as string[])[0]).toMatch(/total_discount/);
    // compact projection still applied to put response
    expect(result).not.toHaveProperty("p_utm_source");
  });
});
