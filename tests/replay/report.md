# Phase 6 Replay Report

Generated: 2026-05-08T09:03:20.734Z
Total calls: 45 (read-only actions only)
Successful: 45
Failed: 0

## Per-tool aggregation

| Tool.action | Calls | Full bytes | Compact bytes | Reduction (compact vs full) | Compact vs goclaw baseline |
|---|---|---|---|---|---|
| lookup_address.communes | 7 | 12705 | 9298 | 26.8% | 54.5% |
| lookup_address.districts | 8 | 14896 | 9180 | 38.4% | 62.6% |
| lookup_address.provinces | 2 | 14320 | 6514 | 54.5% | 41.4% |
| manage_products.list | 27 | 95919 | 35356 | 63.1% | 75.8% |
| manage_warehouses.list | 1 | 2605 | 1600 | 38.6% | 56.3% |

## Acceptance gates

- Total full bytes: 140445
- Total compact bytes: 61948
- Total goclaw baseline bytes: 206071
- Reduction (compact vs full): 55.9%
- Reduction (compact vs goclaw baseline): 69.9%
