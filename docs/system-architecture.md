# Pancake POS MCP - System Architecture

**Version:** 0.1.0  
**Last Updated:** 2026-05-06  
**Status:** Complete (All 5 phases + analytics features implemented and reviewed)

---

## 1. High-Level Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                    AI Assistant (Claude)                          │
│              (uses MCP Protocol to call tools)                    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                    MCP Protocol (JSON-RPC 2.0)
                             │
        ┌────────────────────┴─────────────────────┐
        │                                          │
   ┌────▼─────┐                           ┌──────▼──────┐
   │   stdio  │                           │ Streamable  │
   │Transport │                           │ HTTP        │
   │          │                           │Transport    │
   └────┬─────┘                           └──────┬──────┘
        │                                       │
        └────────────────────┬──────────────────┘
                             │
                    ┌────────▼──────────┐
                    │  MCP Server       │
                    │  (pancake-pos)    │
                    └────────┬──────────┘
                             │
        ┌────────────────────┼──────────────────┐
        │                    │                  │
   ┌────▼────────┐  ┌───────▼─────────┐  ┌────▼────────┐
   │ Tool Registry│  │Resource Registry│  │Error Handler│
   │  (24 tools)  │  │ (7 resources)   │  │             │
   └────┬────────┘  └───────┬─────────┘  └─────────────┘
        │                   │
   ┌────▼─────────────────────────────────┐
   │     Pancake HTTP Client               │
   │  ┌─────────────────────────────────┐ │
   │  │ Rate Limiter (1000/min, 10k/hr)│ │
   │  │ Token-Bucket Algorithm          │ │
   │  └──────┬──────────────────────────┘ │
   │         │                            │
   │  ┌──────▼──────────────────────────┐ │
   │  │ Request Builder                 │ │
   │  │ (URL construction + auth)       │ │
   │  └──────┬──────────────────────────┘ │
   │         │                            │
   │  ┌──────▼──────────────────────────┐ │
   │  │ Fetch Executor                  │ │
   │  │ (retry + timeout: 30s)          │ │
   │  └──────┬──────────────────────────┘ │
   │         │                            │
   │  ┌──────▼──────────────────────────┐ │
   │  │ Response Parser                 │ │
   │  │ (error detection + pagination)  │ │
   │  └────────────────────────────────┘ │
   └──────────────────┬──────────────────┘
                      │
                      └─────────────────────────────────┐
                                                        │
                             ┌──────────────────────────▼──────┐
                             │  Pancake POS REST API            │
                             │  (api.pos.poscake.vn)            │
                             │                                  │
                             │  +23 Endpoint Domains:           │
                             │  • Orders, Products, Customers   │
                             │  • Warehouses, Suppliers, ...    │
                             │  • CRM, eCommerce, Livestream    │
                             │  • Analytics, Webhooks, etc.     │
                             └──────────────────────────────────┘
```

---

## 2. Tool Architecture (24 MCP Tools)

### Tool Registration Pattern
Each of the 24 tools follows this pattern:

```typescript
// 1. Zod Schema (discriminated union for runtime validation)
export const ordersToolSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), search: z.string().optional(), ... }),
  z.object({ action: z.literal("get"), order_id: z.number().int(), ... }),
  z.object({ action: z.literal("create"), bill_full_name: z.string(), ... }),
  // ... one schema per action
]);

// 2. Handler Function (async, returns result or error)
export async function handleOrdersTool(
  args: z.infer<typeof ordersToolSchema>,
  client: PancakeHttpClient
): Promise<OrderResult> { 
  switch(args.action) {
    case "list": return client.getList("/orders", {...});
    case "get": return client.get(`/orders/${args.order_id}`);
    case "create": return client.post("/orders", {...});
    // ...
  }
}

// 3. Tool Registration (flat schema for MCP JSON Schema)
server.tool(
  "manage_orders",
  "Manage orders in Pancake POS...",
  {
    action: z.enum(["list", "get", "create", ...]),
    order_id: z.number().int().optional(),
    // ... all possible params flattened
  },
  async (args) => {
    try {
      const parsed = ordersToolSchema.parse(args);
      const result = await handleOrdersTool(parsed, client);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return formatToolError(error);
    }
  }
);
```

### The 24 Tools Organized by Phase

#### Phase 1: Core POS (4 tools)
1. **manage_orders** (80+ lines)
   - Actions: list, get, create, update, delete, print, ship, call_later
   - Key params: search, status filter, date range, pagination
   - Returns: Order objects with nested items, customer, shipping info

2. **manage_products** (60+ lines)
   - Actions: list, get, create, update, delete, list_variations, create_variation
   - Key params: search by name/SKU/barcode, category filter
   - Returns: Product with variants, pricing, images

3. **manage_customers** (50+ lines)
   - Actions: list, get, create, update, delete, reward_history, add_note
   - Key params: search by name/phone/email
   - Returns: Customer profile with tags, notes, reward points

4. **manage_inventory** (40+ lines)
   - Actions: report (read-only aggregation)
   - Key params: warehouse filter, category filter, supplier filter, quantity range
   - Returns: Inventory line items with warehouse-level breakdown

#### Phase 2: Supply Chain (5 tools)
5. **manage_warehouses** (60+ lines)
   - Actions: list, get, create, update, delete
   - Full CRUD for warehouse locations

6. **manage_suppliers** (50+ lines)
   - Actions: list, get, create, update, delete
   - Supplier contact information

7. **manage_purchases** (70+ lines)
   - Actions: list, get, create, update, delete
   - Purchase orders (stock inbound); links supplier → warehouse

8. **manage_transfers** (60+ lines)
   - Actions: list, get, create, update, delete
   - Warehouse-to-warehouse stock moves

9. **manage_stocktaking** (60+ lines)
   - Actions: list, get, create, update, delete
   - Physical inventory count records

#### Phase 3: Sales Extensions (4 tools)
10. **manage_returns** (80+ lines)
    - Actions: list, get, create, update, delete
    - Order return/exchange handling

11. **manage_combos** (70+ lines)
    - Actions: list, get, create, update, delete
    - Product bundle deals with discount

12. **manage_promotions** (60+ lines)
    - Actions: list, get, create, update, delete
    - Campaign discounts (percent or fixed amount)

13. **manage_vouchers** (70+ lines)
    - Actions: list, get, create, update, delete
    - Coupon code management

#### Phase 4: CRM & Multi-Channel (5 tools)
14. **manage_crm_contacts** (60+ lines)
    - Actions: list, get, create, update, delete
    - CRM contact profiles (entry point of sales pipeline)

15. **manage_crm_deals** (60+ lines)
    - Actions: list, get, create, update, delete
    - Sales opportunities linked to contacts

16. **manage_crm_activities** (70+ lines)
    - Actions: list, get, create, update, delete
    - Activities: calls, meetings, notes, emails, tasks

17. **manage_ecommerce** (50+ lines)
    - Actions: sync, list_products
    - Multi-channel sync (Shopee, Lazada, TikTok)

18. **manage_livestream** (60+ lines)
    - Actions: list, get, create, update, delete
    - Live selling sessions

#### Phase 5: Operations (5 tools)
19. **manage_employees** (60+ lines)
    - Actions: list, get, create, update, delete
    - Staff management with roles and warehouse assignments

20. **manage_webhooks** (50+ lines)
    - Actions: list, get, create, update, delete
    - Event subscription management

21. **get_statistics** (40+ lines)
    - Actions: get (read-only aggregation)
    - Types: inventory, sales, orders analytics by time/product/category

22. **get_shop_info** (50+ lines)
    - Actions: get, update
    - Shop profile and settings

23. **lookup_address** (50+ lines)
    - Actions: provinces, districts, communes
    - Vietnamese administrative hierarchy lookup

24. **analytics** (50+ lines)
    - Actions: top_orders, revenue_summary
    - Analytics wrapper leveraging server-side aggregations + sort options for efficient single-call top-N queries and revenue breakdowns

---

## 3. HTTP Client Architecture

### Rate Limiting Strategy (Token-Bucket, Dual-Tier)

```
┌─────────────────────────────────────────────────┐
│        Rate Limiter (Token-Bucket)              │
├─────────────────────────────────────────────────┤
│                                                 │
│  Minute Bucket:         Hour Bucket:            │
│  ┌──────────────────┐   ┌──────────────────┐   │
│  │ Max: 1000        │   │ Max: 10000       │   │
│  │ Refill: 1/60ms   │   │ Refill: 1/360ms  │   │
│  │ Current: N       │   │ Current: M       │   │
│  └──────────────────┘   └──────────────────┘   │
│         ▲                       ▲                │
│         └───────────┬───────────┘                │
│                     │                           │
│              Check BOTH buckets:                │
│              If minute < 1 OR hour < 1:         │
│                Sleep(refill_time)               │
│                                                 │
└─────────────────────────────────────────────────┘
         │
         │ Token consumed
         │
    ┌────▼────────────────────┐
    │  Fetch Executor          │
    │  (30s timeout)           │
    └────┬────────────────────┘
         │
    ┌────▼────────────────────┐
    │  Response >= 500?        │
    │  Retry with backoff?     │
    │  (1s, 2s, 4s)            │
    └────────────────────────┘
```

### HTTP Execution Flow (with Retry)

```
Request Input:
  GET /shops/{shopId}/orders?search=12345

  ↓

URL Construction (Request Builder):
  1. Base: https://api.pos.poscake.vn
  2. Path segment encoding: /shops/{encoded_shopId}/orders
  3. Auth injection: ?api_key=X
  4. Query params (bracket-style arrays): &search=12345&page=1&page_size=30&filter_status[]=1&filter_status[]=2
     (Arrays serialized as key[]=v1&key[]=v2, NOT key=["v1","v2"])
  Final: https://api.pos.poscake.vn/shops/.../orders?search=...&api_key=...&filter_status[]=1&filter_status[]=2

  ↓

Rate Limiter Check:
  Minute bucket: 999 tokens left
  Hour bucket: 9999 tokens left
  ✓ Both > 0, consume 1 from each

  ↓

Fetch Execution (attempt 1):
  fetch(url, { method: "GET", signal: AbortSignal.timeout(30s) })
  Response: 200 OK

  ↓

Response Parsing:
  JSON.parse(response.body)
  ✓ Status OK (4xx/5xx checks)
  ✓ Pagination wrapper applied
  { error: false, status: 200, data: [...], pagination: {...} }

  ↓

Result Returned (via tool handler)
```

### Query Parameter Serialization (Bracket-Style Arrays)

**Critical Detail:** Pancake API requires array parameters as bracket-style repeated keys:
- ✓ Correct: `filter_status[]=1&filter_status[]=2&filter_status[]=3`
- ✗ Wrong: `filter_status=["1","2","3"]` (triggers HTTP 500)

**Implementation** (`request-builder.ts:buildQueryParams`):
```typescript
// Flat array: [1, 2, 3] → key[]=1, key[]=2, key[]=3
// Nested array: [["a","b"], ["c","d"]] → key[]=["a","b"], key[]=["c","d"] (preserve JSON grouping)
// Empty array: [] → omitted (skip entirely)
```

**Rationale:** Wire format must match Pancake server expectations (bracket notation with URLSearchParams).

### Exponential Backoff on Server Error

```
Fetch returns 500/502/503/504 (attempt 1 of 3):
  ↓
  Log error, calculate backoff: 1000ms * 2^0 = 1000ms
  Wait 1000ms, then retry
  ↓
  
If still 5xx (attempt 2 of 3):
  Log error, calculate backoff: 1000ms * 2^1 = 2000ms
  Wait 2000ms, then retry
  ↓
  
If still 5xx (attempt 3 of 3):
  Log error, throw PancakeApiError
  Tool handler catches, returns MCP error response
  ↓
  
AI Assistant receives error, can retry or handle gracefully
```

---

## 4. MCP Resource Architecture (7 Static/Dynamic Resources)

### Resource Registration
Each resource is exposed as a read-only MCP Resource (no write).

```
┌────────────────────────────────────────────────┐
│       MCP Resource Registry                    │
├────────────────────────────────────────────────┤
│                                                │
│  1. order-statuses                            │
│     pancake://reference/order-statuses        │
│     { 1: "Pending", 2: "Completed", ... }     │
│                                                │
│  2. order-sources                             │
│     pancake://reference/order-sources         │
│     { 100: "Facebook", 101: "Shopee", ... }   │
│                                                │
│  3. sort-options                              │
│     pancake://reference/sort-options          │
│     ["inserted_at_desc", "updated_at_asc",...]│
│                                                │
│  4. webhook-events                            │
│     pancake://reference/webhook-events        │
│     ["order.created", "product.updated", ...] │
│                                                │
│  5. error-codes                               │
│     pancake://reference/error-codes           │
│     { 400: "Bad Request", 401: "Unauthorized",│
│                                                │
│  6. rate-limits                               │
│     pancake://reference/rate-limits           │
│     { "per_minute": 1000, "per_hour": 10000 } │
│                                                │
│  7. shipping-partners (DYNAMIC)               │
│     pancake://reference/shipping-partners     │
│     Fetched from API on request (1st time)    │
│     Then cached                               │
│                                                │
└────────────────────────────────────────────────┘
```

---

## 5. Data Flow: A Complete Order Creation Example

```
┌─ User (AI Assistant) ──────────────────────────────────┐
│ "Create an order for customer John at warehouse A"     │
└─────────────────────┬──────────────────────────────────┘
                      │
                      ▼
    ┌──────────────────────────────────────┐
    │  MCP Tool Call (stdio transport)     │
    │  manage_orders action="create"       │
    │  {                                   │
    │    action: "create",                 │
    │    bill_full_name: "John",           │
    │    bill_phone_number: "0123456789",  │
    │    warehouse_id: "uuid-A",           │
    │    items: [                          │
    │      { product_id: "p1", quantity: 2 │
    │    ]                                 │
    │  }                                   │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  Tool Handler (orders-tool.ts)       │
    │  1. Parse with ordersToolSchema      │
    │  2. Extract create params            │
    │  3. Call client.post("/orders", ...) │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  HTTP Client (pancake-http-client)   │
    │  1. Rate limiter check               │
    │  2. Request builder: URL + auth      │
    │  3. Fetch with 30s timeout           │
    │  4. Retry if 5xx (backoff)           │
    │  5. Parse response                   │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  Pancake API (REST)                  │
    │  POST /shops/{shopId}/orders         │
    │  Response: { status: 201, data: {...}│
    └──────────────┬───────────────────────┘
                   │
                   ▼ (reverse path)
    ┌──────────────────────────────────────┐
    │  Response Parser                     │
    │  Validate: error = false, status 201 │
    │  Wrap: { data: {...}, pagination: {} │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  Tool Handler                        │
    │  formatPaginatedResult() applied      │
    │  Return { order_id, status, items... │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  MCP Tool Response                   │
    │  {                                   │
    │    "content": [{                     │
    │      "type": "text",                 │
    │      "text": "{\"order_id\": 12345...│
    │    }]                                │
    │  }                                   │
    └──────────────┬───────────────────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │  User (AI Assistant)                 │
    │  "Order created: #12345 for John"    │
    └──────────────────────────────────────┘
```

---

## 6. Error Handling Architecture

```
┌─────────────────────────────────┐
│  Error Origin                   │
├─────────────────────────────────┤
│ • Validation error (Zod)        │
│ • Network timeout (30s)         │
│ • HTTP error (4xx, 5xx)         │
│ • JSON parse error              │
│ • Rate limiter wait (normal)    │
└────────────┬────────────────────┘
             │
             ▼
    ┌───────────────────────┐
    │ Error Detector        │
    ├───────────────────────┤
    │ if (response.ok)      │
    │   ✓ Success           │
    │ else                  │
    │   throw PancakeApiError│
    └────────┬──────────────┘
             │
             ▼
    ┌───────────────────────┐
    │ formatToolError()      │
    ├───────────────────────┤
    │ catch (error) {       │
    │   return {            │
    │     content: [{       │
    │       type: "text",   │
    │       text: "Error.." │
    │     }],               │
    │     isError: true     │
    │   }                   │
    │ }                     │
    └────────┬──────────────┘
             │
             ▼
    ┌───────────────────────┐
    │ MCP Error Response    │
    │ AI Assistant handles  │
    │ error & can retry     │
    └───────────────────────┘
```

### Error Codes and Meanings
| Code | Meaning | Retry Behavior |
|------|---------|----------------|
| 400 | Bad Request | No (invalid params) |
| 401 | Unauthorized | No (auth failed) |
| 403 | Forbidden | No (permission denied) |
| 404 | Not Found | No (resource missing) |
| 429 | Rate Limited | Yes (backoff + retry) |
| 500+ | Server Error | Yes (exponential backoff) |

---

## 7. Transport Architecture

### Stdio Transport (Default)
```
┌─────────────────────────────────┐
│   MCP Server (stdio)             │
│   stdin:  JSON-RPC 2.0 requests  │ ◄─── Claude Desktop
│   stdout: JSON-RPC 2.0 responses │     or other client
│   stderr: logs                   │
└─────────────────────────────────┘
```

**Use case:** AI assistant running on same machine, single-threaded communication

### Streamable HTTP Transport
```
┌─────────────────────────────────┐
│   MCP Server (HTTP)              │
│   POST /api/messages             │ ◄─── Multiple clients
│   Streamable JSON responses      │     or network access
└─────────────────────────────────┘
```

**Use case:** Cloud deployment, multi-tenant, API gateways

---

## 8. Configuration & Security

### Authentication Flow
```
User provides at startup:
  PANCAKE_POS_BASE_URL       = "https://api.pos.poscake.vn"
  PANCAKE_POS_API_KEY        = "<bearer-token>"
  PANCAKE_POS_SHOP_ID        = "<shop-uuid>"

Request Builder injects:
  Every URL gets: ?shop_id={shopId}&access_token={apiKey}

Example:
  https://api.pos.poscake.vn/shops/{shopId}/orders
  ?shop_id=abc123&access_token=xyz789
```

### Known Security Patterns
✓ Path segment encoding in URL construction  
✓ API key never logged (redactUrl helper)  
✓ 30s fetch timeout (prevents hanging connections)  
⚠️ TODO: Path traversal defense (encode segments in request-builder)  

---

## 9. Scalability Considerations

### Current Limitations
- **Single Shop:** One MCP server instance = one Pancake shop
- **Concurrency:** Enforced by rate limiter (1000 req/min soft cap)
- **Memory:** ~50MB per server instance
- **State:** Only rate limiter state (token buckets) held in memory

### Scaling Strategies
1. **Multiple Instances:** Deploy N servers, each with different PANCAKE_POS_SHOP_ID
2. **Load Balancer:** Route HTTP requests to multiple instances
3. **Shared Rate Limit:** Could implement Redis-backed rate limiter for true multi-instance coordination
4. **Caching Layer:** Add Redis for frequently accessed data (products, categories)

---

## 10. Deployment Architecture

### Entry Points

Two entry points exist for different deployment models:

#### `src/index.ts` (Bun/Node.js)
- Default entry point for stdio and HTTP transports
- Supports both `--stdio` (default) and `--http` flags
- Uses Bun runtime or Node.js 18+
- Persistent server lifecycle (respawn on exit)

#### `src/worker.ts` (Cloudflare Workers)
- Entry point for serverless Cloudflare Workers deployment
- Handles HTTP requests via Cloudflare Workers fetch handler
- Per-request MCP server lifecycle (created fresh on each request)
- Configured via `wrangler.toml`

### Development Mode
```bash
bun run src/index.ts --stdio
# Single-threaded, suitable for local testing
```

### Production Mode (Stdio)
```bash
bun run src/index.ts --stdio
# Run as background service with process manager (PM2, systemd, etc.)
```

### Production Mode (HTTP)
```bash
bun run src/index.ts --http
# Listens on localhost:3000
# Recommend: Nginx/Caddy reverse proxy + TLS termination
```

### Serverless Mode (Cloudflare Workers)
```bash
wrangler deploy
# Deploys to Cloudflare Workers global edge network
# Recommended: Set secrets via wrangler CLI or dashboard
```

---

## 11. Cloudflare Workers Deployment Architecture

Extracted on 2026-05-08 to keep this file under the 800-LOC budget. See **[`workers-architecture.md`](./workers-architecture.md)** for the per-request lifecycle, `HttpClientOptions` tuning, CORS/auth design, endpoints, and Bun-vs-Workers tradeoffs.


---

## 12. Response Projection Layer

### Overview
New json-mask-based projection system reduces response sizes by 50–85% for bandwidth-constrained scenarios (e.g., Cloudflare Workers, mobile clients).

### Architecture
```
Tool Handler (raw API response)
  ↓
project(data, "compact")  // Apply compact-masks.ts mask
  ↓
Lightweight JSON (id, status, key fields only)
  ↓
MCP Response
```

### Masks
Central registry in `src/shared/compact-masks.ts`:
- **orders:** id, status, bill_full_name, items[id, name, qty, price], total_price
- **products:** id, name, sku, category_id, images[url]
- **warehouses:** id, name, address
- **address:** province_id, new_province_id, new_commune_id (for lookups)

### Verbosity Parameter
Tools can accept `verbosity` parameter to override defaults:
```typescript
// Compact (50 bytes)
GET /manage_orders?action=list&verbosity=compact

// Full (100+ bytes)
GET /manage_orders?action=list&verbosity=full&fields[]=items[customized_fields]
```

**Backward Compatibility:** Existing callers get compact by default; can opt-in to full with parameter.

---

## 13. Replay Framework & Validation (Phase 6)

### Purpose
Validate byte-reduction goals and production-trace coverage.

### Structure
```
tests/replay/
├── replay-trace.ts       # Framework: load trace, invoke tool, measure bytes
├── traces.json           # Fixture: captured Pancake API responses from production
└── report.md             # Acceptance criteria: byte-reduction targets per tool
```

### Validation
Runs on CI; asserts:
- Compact projection < target byte size
- All production fields present in compact masks (no data loss)
- Graceful fallback to full mode if compression exceeds threshold

---

## 14. Key Architectural Principles

### 1. Zero State Between Requests
Each request is independent; no session affinity required.

### 2. Transparent Rate Limiting
Client doesn't need to manage limits; HTTP client handles automatically.

### 3. Fail-Fast Error Handling
Validation errors return immediately; no silent data corruption.

### 4. Resource-First Design
Tools are thin wrappers over HTTP; all logic in client layer.

### 5. MCP Protocol Compliance
Uses only standard MCP SDK; no custom extensions.

