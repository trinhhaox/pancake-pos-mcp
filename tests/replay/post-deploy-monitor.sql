-- Run 24h after wrangler deploy to measure live compact-mode impact.
-- Deploy time: 2026-05-08 16:14 UTC+7
--
-- Usage:
--   docker exec goclaw-postgres-1 psql -U goclaw -d goclaw \
--     -f /path/to/post-deploy-monitor.sql
--
-- Compares per-tool avg output_preview bytes pre-deploy (last 7 days
-- excluding today) vs post-deploy (since deploy time).

WITH pre AS (
  SELECT tool_name,
         COUNT(*)                          AS calls,
         ROUND(AVG(LENGTH(output_preview))) AS avg_bytes
  FROM spans
  WHERE tool_name LIKE 'mcp_pancake_pos%'
    AND span_type = 'tool_call'
    AND created_at >= NOW() - INTERVAL '7 days'
    AND created_at <  '2026-05-08 16:14:00'
  GROUP BY tool_name
),
post AS (
  SELECT tool_name,
         COUNT(*)                          AS calls,
         ROUND(AVG(LENGTH(output_preview))) AS avg_bytes
  FROM spans
  WHERE tool_name LIKE 'mcp_pancake_pos%'
    AND span_type = 'tool_call'
    AND created_at >= '2026-05-08 16:14:00'
  GROUP BY tool_name
)
SELECT
  COALESCE(pre.tool_name, post.tool_name) AS tool,
  pre.calls   AS pre_calls,
  pre.avg_bytes  AS pre_avg,
  post.calls  AS post_calls,
  post.avg_bytes AS post_avg,
  CASE
    WHEN pre.avg_bytes IS NULL OR post.avg_bytes IS NULL THEN NULL
    ELSE ROUND(100.0 * (1 - post.avg_bytes::numeric / pre.avg_bytes), 1)
  END AS reduction_pct
FROM pre
FULL OUTER JOIN post ON pre.tool_name = post.tool_name
ORDER BY pre.avg_bytes DESC NULLS LAST;
