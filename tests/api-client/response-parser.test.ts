import { describe, expect, test } from "vitest";
import { parsePaginatedResponse } from "../../src/api-client/response-parser.js";

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parsePaginatedResponse - aggs pass-through", () => {
  test("forwards aggs from API body", async () => {
    const r = await parsePaginatedResponse(
      makeResponse({
        data: [{ id: 1 }],
        success: true,
        page_number: 1,
        page_size: 1,
        total_entries: 100,
        total_pages: 100,
        aggs: {
          cod: { value: 4.55e8 },
          status: { buckets: [{ key: "0", doc_count: 50 }] },
        },
      }),
    );
    expect(r.aggs).toBeDefined();
    expect(r.aggs?.cod).toEqual({ value: 4.55e8 });
  });

  test("absent aggs → undefined", async () => {
    const r = await parsePaginatedResponse(
      makeResponse({
        data: [],
        success: true,
        page_number: 1,
        page_size: 30,
        total_entries: 0,
        total_pages: 0,
      }),
    );
    expect(r.aggs).toBeUndefined();
  });
});
