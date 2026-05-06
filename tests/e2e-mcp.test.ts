/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

const AUTH_HEADER = { Authorization: "Bearer test-token" };

function mcpRequest(method: string, params: unknown = {}, id = 1) {
  return {
    method: "POST" as const,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...AUTH_HEADER,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id }),
  };
}

describe("MCP Protocol E2E", () => {
  it("completes initialize handshake", async () => {
    const res = await SELF.fetch(
      "http://localhost/mcp",
      mcpRequest("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      }),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { serverInfo: { name: string }; protocolVersion: string };
    };
    expect(json.result).toBeDefined();
    expect(json.result?.serverInfo.name).toBe("pancake-pos");
    expect(json.result?.protocolVersion).toBeDefined();
  });
});

describe("MCP Tools", () => {
  it("lists all 24 tools", async () => {
    const res = await SELF.fetch(
      "http://localhost/mcp",
      mcpRequest("tools/list"),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { tools: Array<{ name: string }> };
    };
    expect(json.result?.tools.length).toBe(24);

    const names = json.result?.tools.map((t) => t.name) ?? [];
    expect(names).toContain("manage_orders");
    expect(names).toContain("manage_products");
    expect(names).toContain("get_statistics");
    expect(names).toContain("lookup_address");
    expect(names).toContain("get_shop_info");
    expect(names).toContain("manage_webhooks");
    expect(names).toContain("analytics");
  });
});

describe("MCP Resources", () => {
  it("lists all 7 resources", async () => {
    const res = await SELF.fetch(
      "http://localhost/mcp",
      mcpRequest("resources/list"),
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      result?: { resources: unknown[] };
    };
    expect(json.result?.resources.length).toBe(7);
  });
});

describe("Error handling", () => {
  it("returns 401 without auth token", async () => {
    const res = await SELF.fetch("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns JSON-RPC error for invalid method", async () => {
    const res = await SELF.fetch(
      "http://localhost/mcp",
      mcpRequest("nonexistent/method"),
    );
    // JSON-RPC errors use HTTP 200 with error in body
    expect(res.status).toBe(200);
    const json = (await res.json()) as { error?: unknown };
    expect(json.error).toBeDefined();
  });
});
