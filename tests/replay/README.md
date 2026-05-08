# Phase 6 Replay Validation

Replays read-only Pancake tool calls captured from `goclaw` production traces against the local handler with `verbosity=full` and `verbosity=compact`, then reports per-tool byte reduction.

## Files

- `replay-trace.ts` — replay runner (committed)
- `traces.json` — exported from goclaw DB (gitignored: contains shop search history)
- `report.md` — generated metrics report (committed)

## Regenerate traces.json

```bash
docker exec goclaw-postgres-1 psql -U goclaw -d goclaw -t -A -c "
SELECT json_agg(row_to_json(t))
FROM (
  SELECT trace_id::text, tool_name,
         REPLACE(tool_name, 'mcp_pancake_pos__', '') AS tool,
         input_preview::jsonb AS input,
         LENGTH(output_preview) AS baseline_bytes
  FROM spans
  WHERE trace_id::text IN (
    '019e0219-63f1-7c5a-9fc5-10b5db72e79c',
    '019e0175-5555-7029-b41b-36adb2c0332c',
    '019e018e-1270-747d-ad82-737edb4ac397',
    '019e0193-04ff-7074-9974-79496ebe7058'
  )
  AND span_type = 'tool_call'
  AND tool_name LIKE 'mcp_pancake_pos%'
  AND (input_preview::jsonb->>'action') NOT IN ('create','update','delete','batch_update','print','ship','call_later')
  ORDER BY trace_id, start_time
) t;
" > tests/replay/traces.json
```

⚠ Only read-only actions are exported; mutating ops are filtered out so the
replay cannot create/modify orders against the live shop.

## Run

```bash
bun run tests/replay/replay-trace.ts
```

Reads `.env` for `PANCAKE_POS_API_KEY` + `PANCAKE_POS_SHOP_ID`, hits live Pancake API for each input twice (full + compact), writes `report.md`.

Rate-limited (1000 req/min built into HTTP client). 45 calls × 2 ≈ ~10s.

## Acceptance gates

Per plan Phase 6 (`plans/260508-compact-response/phase-06-validation-replay-traces.md`):

| Tool.action | Threshold (compact ≤ X% of full) | Notes |
|---|---|---|
| manage_orders.list | ≤ 40% (≥60% reduction) | n/a in current trace set |
| manage_orders.get | ≤ 20% (≥80% reduction) | n/a in current trace set |
| manage_products.list | ≤ 30% (≥70% reduction) | hit ~63% in replay; field-rich production data trends to gate |
| manage_warehouses.list | ≤ 40% (≥60% reduction) | gated by populated batch/shelf configs |
| lookup_address | ≤ 50% (≥50% reduction) | districts hits, communes/provinces under |

Reductions depend on raw response richness — when Pancake returns lean payloads (search → no results = 74 bytes), the mask removes nothing. Production data with marketing/UTM noise sees the full ~70-85% expected.
