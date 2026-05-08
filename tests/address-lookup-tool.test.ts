import { describe, it, expect, vi } from "vitest";
import {
  addressLookupToolSchema,
  handleAddressLookupTool,
} from "../src/tools/address-lookup-tool.js";
import type { PancakeHttpClient } from "../src/api-client/pancake-http-client.js";

function mockClient(
  impl: (path: string, params?: Record<string, unknown>) => Promise<unknown[]>,
): PancakeHttpClient {
  return {
    get: vi.fn((path: string, params?: Record<string, unknown>) =>
      impl(path, params).then((data) => ({ data, success: true })),
    ),
  } as unknown as PancakeHttpClient;
}

describe("addressLookupToolSchema — /geo migration shape", () => {
  it("provinces accepts no params", () => {
    expect(addressLookupToolSchema.safeParse({ action: "provinces" }).success).toBe(true);
  });

  it("districts requires province_id", () => {
    expect(addressLookupToolSchema.safeParse({ action: "districts" }).success).toBe(false);
    expect(
      addressLookupToolSchema.safeParse({ action: "districts", province_id: "805" }).success,
    ).toBe(true);
  });

  it("communes accepts province_id (OLD or NEW) — server detects prefix", () => {
    expect(
      addressLookupToolSchema.safeParse({ action: "communes", province_id: "805" }).success,
    ).toBe(true);
    expect(
      addressLookupToolSchema.safeParse({ action: "communes", province_id: "84_VN132" }).success,
    ).toBe(true);
  });

  it("communes accepts district_id (OLD only)", () => {
    expect(
      addressLookupToolSchema.safeParse({ action: "communes", district_id: "80505" }).success,
    ).toBe(true);
  });

  it("communes accepts both province_id and district_id together", () => {
    expect(
      addressLookupToolSchema.safeParse({
        action: "communes",
        province_id: "805",
        district_id: "80505",
      }).success,
    ).toBe(true);
  });
});

describe("handleAddressLookupTool — /geo endpoint dispatch", () => {
  it("provinces calls geo/provinces (no params), returns wrapped data", async () => {
    const calls: { path: string; params?: unknown }[] = [];
    const client = mockClient((path, params) => {
      calls.push({ path, params });
      return Promise.resolve([{ id: "805", name: "An Giang", new_id: "84_VN132" }]);
    });
    const result = await handleAddressLookupTool({ action: "provinces" }, client);
    expect(calls).toEqual([{ path: "geo/provinces", params: undefined }]);
    expect(result).toEqual({ data: [{ id: "805", name: "An Giang", new_id: "84_VN132" }] });
  });

  it("districts calls geo/districts with province_id query param", async () => {
    const calls: { path: string; params?: unknown }[] = [];
    const client = mockClient((path, params) => {
      calls.push({ path, params });
      return Promise.resolve([{ id: "80505", name: "Huyện An Phú", province_id: "805" }]);
    });
    await handleAddressLookupTool({ action: "districts", province_id: "805" }, client);
    expect(calls).toEqual([{ path: "geo/districts", params: { province_id: "805" } }]);
  });

  it("communes with district_id calls geo/communes (3-tier OLD)", async () => {
    const calls: { path: string; params?: unknown }[] = [];
    const client = mockClient((path, params) => {
      calls.push({ path, params });
      return Promise.resolve([]);
    });
    await handleAddressLookupTool({ action: "communes", district_id: "80505" }, client);
    expect(calls).toEqual([{ path: "geo/communes", params: { district_id: "80505" } }]);
  });

  it("communes with province_id (NEW) calls geo/communes — server detects 2-tier", async () => {
    const calls: { path: string; params?: unknown }[] = [];
    const client = mockClient((path, params) => {
      calls.push({ path, params });
      return Promise.resolve([]);
    });
    await handleAddressLookupTool({ action: "communes", province_id: "84_VN132" }, client);
    expect(calls).toEqual([{ path: "geo/communes", params: { province_id: "84_VN132" } }]);
  });

  it("communes with both params forwards both", async () => {
    const calls: { path: string; params?: unknown }[] = [];
    const client = mockClient((path, params) => {
      calls.push({ path, params });
      return Promise.resolve([]);
    });
    await handleAddressLookupTool(
      { action: "communes", province_id: "805", district_id: "80505" },
      client,
    );
    expect(calls).toEqual([
      { path: "geo/communes", params: { province_id: "805", district_id: "80505" } },
    ]);
  });

  it("communes with neither param throws (handler validation)", async () => {
    const client = mockClient(() => Promise.resolve([]));
    await expect(
      handleAddressLookupTool({ action: "communes" } as never, client),
    ).rejects.toThrow(/province_id|district_id/);
  });

  it("upstream error propagates (no deprecation wrapper any more)", async () => {
    const client = {
      get: vi.fn().mockRejectedValue(new Error("network down")),
    } as unknown as PancakeHttpClient;
    await expect(
      handleAddressLookupTool({ action: "provinces" }, client),
    ).rejects.toThrow("network down");
  });
});

describe("address lookup compact projection (Phase 5)", () => {
  const provincesFixture = require("./fixtures/geo-provinces-full-response.json");
  const communesOldFixture = require("./fixtures/geo-communes-old-full-response.json");
  const communesNewFixture = require("./fixtures/geo-communes-new-full-response.json");

  it("provinces compact has id, name, new_id; strips name_en/country_code/region_type", async () => {
    const client = mockClient(async () => provincesFixture.data);
    const result = (await handleAddressLookupTool(
      { action: "provinces" },
      client,
    )) as { data: Record<string, unknown>[] };
    expect(result.data.length).toBe(provincesFixture.data.length);
    const first = result.data[0]!;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("new_id");
    for (const k of ["name_en", "country_code", "region_type"]) {
      expect(first).not.toHaveProperty(k);
    }
  });

  it("communes OLD shape preserves district_id and new_id", async () => {
    const client = mockClient(async () => communesOldFixture.data);
    const result = (await handleAddressLookupTool(
      { action: "communes", province_id: "805" },
      client,
    )) as { data: Record<string, unknown>[] };
    const first = result.data[0]!;
    expect(first).toHaveProperty("district_id");
    expect(first).toHaveProperty("new_id");
    expect(first).toHaveProperty("province_id");
  });

  it("communes NEW shape: district_id is null, new_id may be null — both projected through", async () => {
    const client = mockClient(async () => communesNewFixture.data);
    const result = (await handleAddressLookupTool(
      { action: "communes", province_id: "84_VN132" },
      client,
    )) as { data: Record<string, unknown>[] };
    const first = result.data[0]!;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    // district_id present but null in NEW shape
    expect("district_id" in first).toBe(true);
  });

  it("verbosity=full returns raw response", async () => {
    const client = mockClient(async () => provincesFixture.data);
    const result = (await handleAddressLookupTool(
      { action: "provinces", verbosity: "full" },
      client,
    )) as { data: Record<string, unknown>[] };
    expect(result.data[0]).toEqual(provincesFixture.data[0]);
  });

  it("compact size <= 60% of full for provinces", async () => {
    const fullBytes = JSON.stringify(provincesFixture.data).length;
    const client = mockClient(async () => provincesFixture.data);
    const result = (await handleAddressLookupTool(
      { action: "provinces" },
      client,
    )) as { data: unknown };
    const compactBytes = JSON.stringify(result.data).length;
    expect(compactBytes / fullBytes).toBeLessThan(0.6);
  });
});

describe("buildRequestUrl — geo is a global prefix (no shop scope)", () => {
  it("geo path is not prefixed with /shops/{id}/", async () => {
    const { buildRequestUrl } = await import("../src/api-client/request-builder.js");
    const url = buildRequestUrl(
      "https://pos.pancake.vn/api/v1",
      "123456789",
      "test-key",
      "geo/provinces",
    );
    expect(url).toContain("/api/v1/geo/provinces");
    expect(url).not.toContain("/shops/123456789/geo");
  });

  it("geo with query params attaches them and stays unscoped", async () => {
    const { buildRequestUrl } = await import("../src/api-client/request-builder.js");
    const url = buildRequestUrl(
      "https://pos.pancake.vn/api/v1",
      "123456789",
      "test-key",
      "geo/communes",
      { province_id: "84_VN132" },
    );
    expect(url).toContain("province_id=84_VN132");
    expect(url).not.toContain("/shops/");
  });
});
