/**
 * Replay production tool inputs against the local handler with both
 * verbosity=full and verbosity=compact, measure byte ratios.
 *
 * Read-only actions only (filtered upstream in traces.json export).
 *
 * Run: bun run tests/replay/replay-trace.ts
 *
 * Env: requires PANCAKE_POS_API_KEY + PANCAKE_POS_SHOP_ID in .env
 *      (already used by the production worker — same credentials).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "../../src/config.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..", "..");
import { PancakeHttpClient } from "../../src/api-client/pancake-http-client.js";
import { handleOrdersTool } from "../../src/tools/orders-tool.js";
import { handleProductsTool } from "../../src/tools/products-tool.js";
import { handleWarehousesTool } from "../../src/tools/warehouses-tool.js";
import { handleAddressLookupTool } from "../../src/tools/address-lookup-tool.js";
import { ordersToolSchema } from "../../src/tools/orders-tool.js";
import { productsToolSchema } from "../../src/tools/products-tool.js";
import { warehousesToolSchema } from "../../src/tools/warehouses-tool.js";
import { addressLookupToolSchema } from "../../src/tools/address-lookup-tool.js";

interface TraceEntry {
  trace_id: string;
  tool_name: string;
  tool: string;
  input: Record<string, unknown>;
  baseline_bytes: number;
}

interface ReplayResult {
  trace: string;
  tool: string;
  action: string;
  baseline_bytes: number;
  full_bytes: number;
  compact_bytes: number;
  reduction_vs_full: number;
  reduction_vs_baseline: number;
  ok: boolean;
  error?: string;
}

const TOOL_HANDLERS = {
  manage_orders: { handle: handleOrdersTool, schema: ordersToolSchema },
  manage_products: { handle: handleProductsTool, schema: productsToolSchema },
  manage_warehouses: { handle: handleWarehousesTool, schema: warehousesToolSchema },
  lookup_address: { handle: handleAddressLookupTool, schema: addressLookupToolSchema },
} as const;

type ToolKey = keyof typeof TOOL_HANDLERS;

function loadEnvFromDotEnv(): Record<string, string> {
  const envPath = join(REPO_ROOT, ".env");
  try {
    const txt = readFileSync(envPath, "utf8");
    const env: Record<string, string> = {};
    for (const line of txt.split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[1] && m[2] !== undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return env;
  } catch (err) {
    console.warn(
      `[replay] could not read ${envPath}: ${err instanceof Error ? err.message : err}\n` +
        `[replay] relying on process.env for credentials`,
    );
    return {};
  }
}

async function callOnce(
  client: PancakeHttpClient,
  tool: ToolKey,
  input: Record<string, unknown>,
  verbosity: "compact" | "full",
): Promise<unknown> {
  const handler = TOOL_HANDLERS[tool];
  const args = { ...input, verbosity };
  const parsed = handler.schema.parse(args);
  return await handler.handle(parsed as never, client);
}

async function main() {
  const merged = { ...loadEnvFromDotEnv(), ...process.env };
  const config = loadConfig(merged as Record<string, unknown>);
  const client = new PancakeHttpClient(config, { enableRateLimiter: true });

  const traces = JSON.parse(
    readFileSync(join(SCRIPT_DIR, "traces.json"), "utf8"),
  ) as TraceEntry[];

  console.log(`Replaying ${traces.length} read-only tool calls\n`);

  const results: ReplayResult[] = [];

  for (let i = 0; i < traces.length; i++) {
    const t = traces[i]!;
    const action = (t.input.action as string) ?? "unknown";
    const tool = t.tool as ToolKey;

    if (!(tool in TOOL_HANDLERS)) {
      results.push({
        trace: t.trace_id.slice(0, 13),
        tool,
        action,
        baseline_bytes: t.baseline_bytes,
        full_bytes: 0,
        compact_bytes: 0,
        reduction_vs_full: 0,
        reduction_vs_baseline: 0,
        ok: false,
        error: `unknown tool ${tool}`,
      });
      continue;
    }

    process.stdout.write(`[${i + 1}/${traces.length}] ${tool}.${action}... `);

    try {
      const fullResp = await callOnce(client, tool, t.input, "full");
      const compactResp = await callOnce(client, tool, t.input, "compact");
      const fullBytes = JSON.stringify(fullResp).length;
      const compactBytes = JSON.stringify(compactResp).length;
      const reduction = 1 - compactBytes / fullBytes;
      const reductionVsBaseline = 1 - compactBytes / t.baseline_bytes;
      results.push({
        trace: t.trace_id.slice(0, 13),
        tool,
        action,
        baseline_bytes: t.baseline_bytes,
        full_bytes: fullBytes,
        compact_bytes: compactBytes,
        reduction_vs_full: reduction,
        reduction_vs_baseline: reductionVsBaseline,
        ok: true,
      });
      console.log(
        `full=${fullBytes}B compact=${compactBytes}B (-${(reduction * 100).toFixed(1)}%)`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        trace: t.trace_id.slice(0, 13),
        tool,
        action,
        baseline_bytes: t.baseline_bytes,
        full_bytes: 0,
        compact_bytes: 0,
        reduction_vs_full: 0,
        reduction_vs_baseline: 0,
        ok: false,
        error: msg.slice(0, 200),
      });
      console.log(`FAIL: ${msg.slice(0, 80)}`);
    }
  }

  // Per-tool aggregations
  const perTool = new Map<
    string,
    { calls: number; full: number; compact: number; baseline: number; ok: number }
  >();
  for (const r of results) {
    if (!r.ok) continue;
    const key = `${r.tool}.${r.action}`;
    const cur = perTool.get(key) ?? { calls: 0, full: 0, compact: 0, baseline: 0, ok: 0 };
    cur.calls++;
    cur.ok++;
    cur.full += r.full_bytes;
    cur.compact += r.compact_bytes;
    cur.baseline += r.baseline_bytes;
    perTool.set(key, cur);
  }

  // Build report
  const lines: string[] = [];
  lines.push(`# Phase 6 Replay Report`, ``);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total calls: ${traces.length} (read-only actions only)`);
  lines.push(`Successful: ${results.filter((r) => r.ok).length}`);
  lines.push(`Failed: ${results.filter((r) => !r.ok).length}`, ``);

  lines.push(`## Per-tool aggregation`, ``);
  lines.push(
    `| Tool.action | Calls | Full bytes | Compact bytes | Reduction (compact vs full) | Compact vs goclaw baseline |`,
  );
  lines.push(`|---|---|---|---|---|---|`);
  for (const [key, v] of [...perTool.entries()].sort()) {
    const reductionFull = ((1 - v.compact / v.full) * 100).toFixed(1);
    const reductionBase = ((1 - v.compact / v.baseline) * 100).toFixed(1);
    lines.push(
      `| ${key} | ${v.calls} | ${v.full} | ${v.compact} | ${reductionFull}% | ${reductionBase}% |`,
    );
  }

  // Acceptance gates from plan Phase 6
  lines.push(``, `## Acceptance gates`, ``);
  const totalFull = [...perTool.values()].reduce((s, v) => s + v.full, 0);
  const totalCompact = [...perTool.values()].reduce((s, v) => s + v.compact, 0);
  const totalBaseline = [...perTool.values()].reduce((s, v) => s + v.baseline, 0);
  const totalReductionFull = ((1 - totalCompact / totalFull) * 100).toFixed(1);
  const totalReductionBase = ((1 - totalCompact / totalBaseline) * 100).toFixed(1);
  lines.push(`- Total full bytes: ${totalFull}`);
  lines.push(`- Total compact bytes: ${totalCompact}`);
  lines.push(`- Total goclaw baseline bytes: ${totalBaseline}`);
  lines.push(`- Reduction (compact vs full): ${totalReductionFull}%`);
  lines.push(`- Reduction (compact vs goclaw baseline): ${totalReductionBase}%`);

  if (results.some((r) => !r.ok)) {
    lines.push(``, `## Failures`, ``);
    for (const r of results.filter((r) => !r.ok)) {
      lines.push(`- ${r.tool}.${r.action} (${r.trace}): ${r.error}`);
    }
  }

  const report = lines.join("\n") + "\n";
  writeFileSync(join(SCRIPT_DIR, "report.md"), report);
  console.log(`\n--- Report written to tests/replay/report.md ---\n`);
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
