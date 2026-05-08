import { describe, it, expect, vi } from "vitest";
import {
  ordersToolSchema,
  handleOrdersTool,
  type OrdersToolInput,
} from "../src/tools/orders-tool.js";
import type { PancakeHttpClient } from "../src/api-client/pancake-http-client.js";
import { formatToolError, PancakeApiError } from "../src/shared/error-handler.js";
import successFixture from "./fixtures/orders-delete/success-resolve.json";
import notFoundFixture from "./fixtures/orders-delete/not-found.json";
import ambiguousFixture from "./fixtures/orders-delete/ambiguous.json";
import notDraftFixture from "./fixtures/orders-delete/not-draft.json";
import upstream404Fixture from "./fixtures/orders-delete/upstream-404.json";

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

function makeListResponse<T>(rows: T[]) {
  return {
    data: rows,
    success: true,
    page_number: 1,
    page_size: 20,
    total_entries: rows.length,
    total_pages: 1,
  };
}

async function captureToolError(fn: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await fn();
  } catch (err) {
    const formatted = formatToolError(err);
    return JSON.parse(formatted.content[0]!.text) as { code: string; message: string };
  }
  throw new Error("expected handler to throw, but it did not");
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

  // Regression: trace 019e0747 / 019e0219 — agent skipped lookup_address and sent
  // bare province_id="701" (a value scraped from the schema example string) for 5
  // orders across 5 different provinces. Server must reject partial OLD/NEW sets.
  it("Create with bare province_id (no district/commune) throws and points to lookup_address", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
        province_id: "701",
      },
    };
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/lookup_address/);
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/missing district_id/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("Create with province_id + district_id but no commune_id throws", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
        province_id: "701",
        district_id: "70101",
      },
    };
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/commune_id/);
    expect(client.post).not.toHaveBeenCalled();
  });

  it("Create with bare new_province_id (no new_commune_id) throws", async () => {
    const client = mockClient();
    const args: OrdersToolInput = {
      ...baseCreate,
      shipping_address: {
        full_name: "A",
        phone_number: "0900000000",
        address: "x",
        new_province_id: "84_VN129",
      },
    };
    await expect(handleOrdersTool(args, client)).rejects.toThrow(/new_commune_id/);
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

describe("handleOrdersTool — delete (display_id resolver + status pre-check)", () => {
  it("happy path display_id (default): resolves via getList, pre-checks status:0, deletes by internal id", async () => {
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(
        makeListResponse([{ id: 109502, system_id: 521, status: 0 }]),
      ),
      get: vi.fn().mockResolvedValue({ data: { id: 109502, status: 0 }, success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const result = await handleOrdersTool(parsed, client);

    expect(client.getList).toHaveBeenCalledWith(
      "orders",
      expect.objectContaining({
        search: "521",
        filter_status: [0],
        page_size: 200,
      }),
    );
    expect(client.get).toHaveBeenCalledWith("orders/109502");
    expect(client.delete).toHaveBeenCalledWith("orders/109502");
    expect(result).toEqual({ success: true, message: "Order 521 deleted" });
  });

  it("internal-id passthrough: id_kind:'id' skips getList, calls get + delete with given id", async () => {
    const getList = vi.fn();
    const client = mockClient({
      getList,
      get: vi.fn().mockResolvedValue({ data: { id: 109502, status: 0 }, success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: 109502,
      id_kind: "id",
    });
    const result = await handleOrdersTool(parsed, client);
    expect(getList).not.toHaveBeenCalled();
    expect(client.get).toHaveBeenCalledWith("orders/109502");
    expect(client.delete).toHaveBeenCalledWith("orders/109502");
    expect((result as { message: string }).message).toBe("Order 109502 deleted");
  });

  it("NOT_FOUND_DISPLAY_ID: 0 matches → structured code, delete NOT called", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(makeListResponse([])),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 999 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("NOT_FOUND_DISPLAY_ID");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("AMBIGUOUS_DISPLAY_ID: 2+ matches → structured code", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(
        makeListResponse([
          { id: 1, system_id: 521, status: 0 },
          { id: 2, system_id: 521, status: 0 },
        ]),
      ),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("AMBIGUOUS_DISPLAY_ID");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("NOT_DRAFT: status !== 0 → structured code with hint to use update; delete NOT called", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(
        makeListResponse([{ id: 109502, system_id: 521, status: 0 }]),
      ),
      get: vi.fn().mockResolvedValue({ data: { id: 109502, status: 1 }, success: true }),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("NOT_DRAFT");
    expect(out.message).toMatch(/update/);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("STATUS_UNKNOWN: missing status field → fail-closed (not silently treated as draft)", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(
        makeListResponse([{ id: 109502, system_id: 521, status: 0 }]),
      ),
      get: vi.fn().mockResolvedValue({ data: { id: 109502 }, success: true }),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("STATUS_UNKNOWN");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("fallback page-scan: search returns 0 → page-scan finds the order", async () => {
    const getList = vi
      .fn()
      // stage 1: search returns nothing (search doesn't index system_id on this shop)
      .mockResolvedValueOnce(makeListResponse([]))
      // stage 2 page 1: 200 unrelated rows
      .mockResolvedValueOnce(
        makeListResponse(
          Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, system_id: 1000 + i, status: 0 })),
        ),
      )
      // stage 2 page 2: target appears here
      .mockResolvedValueOnce(
        makeListResponse([{ id: 109502, system_id: 521, status: 0 }]),
      );
    const client = mockClient({
      getList,
      get: vi.fn().mockResolvedValue({ data: { id: 109502, status: 0 }, success: true }),
      delete: vi.fn().mockResolvedValue({ success: true }),
    });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const result = await handleOrdersTool(parsed, client);
    expect(getList).toHaveBeenCalledTimes(3);
    expect(getList).toHaveBeenNthCalledWith(
      2,
      "orders",
      expect.objectContaining({ filter_status: [0], page_number: 1, page_size: 200 }),
    );
    expect(getList).toHaveBeenNthCalledWith(
      3,
      "orders",
      expect.objectContaining({ filter_status: [0], page_number: 2, page_size: 200 }),
    );
    expect(client.delete).toHaveBeenCalledWith("orders/109502");
    expect((result as { message: string }).message).toBe("Order 521 deleted");
  });

  it("fallback page-scan: 5-page cap exhausted → NOT_FOUND_DISPLAY_ID with hint", async () => {
    const fullPage = makeListResponse(
      Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, system_id: 1000 + i, status: 0 })),
    );
    const getList = vi
      .fn()
      .mockResolvedValueOnce(makeListResponse([]))
      .mockResolvedValue(fullPage);
    const deleteMock = vi.fn();
    const client = mockClient({ getList, delete: deleteMock });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 521 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("NOT_FOUND_DISPLAY_ID");
    expect(out.message).toMatch(/scanned 1000/);
    // 1 search call + 5 page-scan calls
    expect(getList).toHaveBeenCalledTimes(6);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("LIKELY_INTERNAL_ID: internal-id-shaped input (>1M) with default id_kind → guard rejects without HTTP", async () => {
    const getList = vi.fn();
    const deleteMock = vi.fn();
    const client = mockClient({ getList, delete: deleteMock });
    const parsed = ordersToolSchema.parse({ action: "delete", order_id: 5_000_000 });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("LIKELY_INTERNAL_ID");
    expect(out.message).toMatch(/id_kind/);
    expect(getList).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("handleOrdersTool — delete fixture replay", () => {
  it("success-resolve fixture: deletes and returns echo of caller input", async () => {
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(successFixture.list),
      get: vi.fn().mockResolvedValue({ data: successFixture.detail, success: true }),
      delete: vi.fn().mockResolvedValue(successFixture.delete),
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: successFixture.input.display_id,
    });
    const result = await handleOrdersTool(parsed, client);
    expect(result).toEqual({
      success: true,
      message: `Order ${successFixture.input.display_id} deleted`,
    });
    expect(client.delete).toHaveBeenCalledWith(`orders/${successFixture.detail.id}`);
  });

  it("not-found fixture: code=NOT_FOUND_DISPLAY_ID, delete not called", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(notFoundFixture.list),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: notFoundFixture.input.display_id,
    });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("NOT_FOUND_DISPLAY_ID");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("ambiguous fixture: code=AMBIGUOUS_DISPLAY_ID, lists candidate ids", async () => {
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(ambiguousFixture.list),
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: ambiguousFixture.input.display_id,
    });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("AMBIGUOUS_DISPLAY_ID");
    for (const row of ambiguousFixture.list.data) {
      expect(out.message).toContain(String(row.id));
    }
  });

  it("not-draft fixture: code=NOT_DRAFT, hint mentions update", async () => {
    const deleteMock = vi.fn();
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(notDraftFixture.list),
      get: vi.fn().mockResolvedValue({ data: notDraftFixture.detail, success: true }),
      delete: deleteMock,
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: notDraftFixture.input.display_id,
    });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("NOT_DRAFT");
    expect(out.message).toMatch(/update/);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("upstream-404 fixture: pre-check GET 404 → code=ORDER_NOT_FOUND", async () => {
    const err = upstream404Fixture.detail_error;
    const client = mockClient({
      getList: vi.fn().mockResolvedValue(upstream404Fixture.list),
      get: vi.fn().mockRejectedValue(new PancakeApiError(err.code, err.message, err.httpStatus)),
    });
    const parsed = ordersToolSchema.parse({
      action: "delete",
      order_id: upstream404Fixture.input.display_id,
    });
    const out = await captureToolError(() => handleOrdersTool(parsed, client));
    expect(out.code).toBe("ORDER_NOT_FOUND");
  });
});
