# Project Changelog

## [Unreleased]

### orders update: items support + total_discount/surcharge silent-drop guards (2026-05-06)

**Scope:** Fix 3 reports against `manage_orders` (update silent-drops items; total_discount no-op; delete 404).

**Root causes:**
- `items` on `update`: dual-schema mismatch — `tool-registry.ts` exposed `items` to the LLM, but the inner `UpdateAction` (Zod discriminated union) did not declare it, so `.parse()` stripped it before reaching `client.put()`. Pancake API supports replacing items via `PUT /orders/<id>` when order `status === 0` (per `docs/poscake-api-docs.md:264, 284`).
- `total_discount` / `surcharge`: same class as `shipping_fee`/`partner_fee`/`is_free_shipping`/`customer_pay_fee` — silently dropped or recomputed under `api_key` auth. Not previously surfaced.
- DELETE 404: not an MCP bug. Endpoint and URL match spec exactly. 404 reflects business state (order absent / wrong shop / `status > 0`). No code change.

**Changes:**
- `UpdateAction` now accepts `items` (optional). Shape extracted into shared `OrderItemSchema` (DRY with `CreateAction`).
- Pre-GET `status` check on update when `items` present; throws fast with order id + actual status if `status >= 1` (Pancake constraint).
- `FRAGILE_FIELDS` extended with `total_discount`, `surcharge` → verify-after-update warnings now surface for these.
- `tool-registry.ts` inline schema synced (item shape parity with inner schema, action description updated).
- 4 new tests in `tests/orders-tool.test.ts` covering: items schema acceptance, status===0 happy path, status>=1 rejection, total_discount silent-drop warning.

**API Behavior:** Backward-compatible. New capabilities only.

**Verification:** typecheck clean (`tsc --noEmit`); full vitest suite 61/61 pass.

### Public-release preparation (2026-04-29)

**Scope:** Git history cleanup and repository preparation for public release.

**Changes:**
- Shop ID redaction: real shop ID replaced with a placeholder across tests, docs, and tool comments
- Removed internal artifacts: `.claude/`, `plans/`, `docs/journals/`, `.gitkeep` scrubbed from git history via `git filter-repo`
- Personal filesystem path redaction: absolute developer paths rewritten to relative form in history
- Added MIT LICENSE at repo root for open-source distribution
- Updated `.gitignore` to ignore `.claude/`, `plans/`, `docs/journals/`, `.gitkeep` going forward
- Force-pushed cleaned history to remote (private repo, ready to flip to public)
- Tracked file count reduced from 105 → 68 (artifacts, internal docs removed)

**API Behavior:** No changes — all tools, resources, and transport modes remain unchanged.

**Documentation:** Verified all references to shop ID, filesystem paths, and plan locations are accurate for public state.

---

## 2026-04-29 — address-lookup migrated `/address/*` → `/geo/*`

Discovered via Pancake POS web UI network capture. Endpoint was renamed (not removed) and behavior subtly improved:

- `GET /api/v1/geo/provinces` — 63 OLD provinces, each item carries a `new_id` field mapping to NEW format. No separate NEW provinces endpoint exists.
- `GET /api/v1/geo/districts?province_id={OLD}` — OLD only. NEW format has no district level.
- `GET /api/v1/geo/communes?district_id={OLD}` — OLD 3-tier in one district.
- `GET /api/v1/geo/communes?province_id={OLD}` — OLD 3-tier across the province.
- `GET /api/v1/geo/communes?province_id={NEW}` — NEW 2-tier; server detects the `84_VN...` prefix and returns 2-tier shape (`district_id: null`).

Verified on both `pos.pages.fm` and `pos.pancake.vn` with api_key (no JWT needed).

### Changed
- `src/tools/address-lookup-tool.ts`: schema now allows `communes` with `province_id` (OLD or NEW) and/or `district_id` (OLD only); handler asserts at least one is present. Switched from `client.getRaw` to `client.get` to pick up `success: false` validation. Removed the 404 deprecation wrapper.
- `src/api-client/request-builder.ts`: added `/geo` (with and without leading slash) to `globalPrefixes` so the path bypasses shop scope.
- `tests/address-lookup-tool.test.ts`: replaced 3 deprecation tests with 14 cases covering schema, dispatch, validation, and request-builder URL shape.
- `docs/codebase-summary.md`: replaced "known-broken" note with route reference; updated global-prefix list and Critical Issues #3.

---

## 2026-04-28 — Orders update fields & VN address schema overhaul

Plan: `plans/260428-1730-orders-address-schema-overhaul/`

### Added
- `VietnamAddressSchema` shared (`src/shared/schemas.ts`) — supports both OLD 3-tier (`province_id`+`district_id`+`commune_id`) and NEW 2-tier (`new_province_id`+`new_commune_id`) Vietnamese address formats post-2025-07-01 administrative reform.
- `orders update` financial fields: `shipping_fee`, `partner_fee`, `is_free_shipping`, `total_discount`, `surcharge`, `note_print`, `received_at_shop`, `custom_id`, `bill_email`.
- Verify-after-update for orders: when any fragile field (`shipping_fee`, `partner_fee`, `is_free_shipping`) is sent in an update, the handler GETs the order to detect silent-drops and surfaces `warnings: string[]` with per-field workaround hints.
- Handler-layer `assertAddressHasLocation` enforcing province anchor on order create; on update, only when caller sends location fields.

### Changed
- `orders-tool.ts` `CreateAction.shipping_address` and `UpdateAction.shipping_address` now use `VietnamAddressSchema`. `district_id` / `commune_id` are no longer required on create.
- `address-lookup-tool.ts` wraps handler with 404 interceptor, throws structured deprecation message with workaround. Tool surface kept for forward-compat.
- `vitest.config.ts` pins `compatibilityDate: "2026-04-01"` for both plugin and pool to keep miniflare runtime within supported range.

### Excluded (verified silent-drop / out of scope)
- `customer_pay_fee` on `orders update` — Pancake api_key auth silently ignores this field (verified 2026-04-28 on shop 123456789). Schema rejects it.
- Phase 3 (apply VietnamAddressSchema to customers/warehouses/shop-info) **cancelled** after shape verification on 2026-04-28: customers uses `shop_customer_addresses[]` (not `addresses[]`); none of the three endpoints expose `new_*` fields in responses. Pancake has not migrated those endpoints to the 2-tier reform. Bonus: `shop-info-tool` GET endpoint `/shops/{id}/shop` returns HTTP 404 — separate broken endpoint, not yet wrapped.

### Deprecated
- ~~`address-lookup-tool`~~ — superseded by `/geo/*` migration (see entry below dated 2026-04-29).

### Tests
- `tests/shared-schemas.test.ts` — 7 cases for `VietnamAddressSchema`.
- `tests/orders-tool.test.ts` — 17 cases (schema + handler create/update validation + verify-after-update).
- `tests/address-lookup-tool.test.ts` — 3 cases (404 wrapper, non-404 passthrough, success forward-compat).
- Total suite: 46 tests passing.

### References
- Brainstorm: `plans/reports/brainstorm-260428-orders-address-schema-overhaul.md`
- Preflight findings: `plans/260428-1730-orders-address-schema-overhaul/preflight-findings.md`
