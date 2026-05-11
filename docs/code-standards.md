# Pancake POS MCP - Code Standards

**Version:** 0.1.0  
**Last Updated:** 2026-04-10  
**Applies To:** All TypeScript files in `src/`

---

## 1. Project Structure & File Organization

### Directory Layout (Enforced)
```
src/
├── api-client/              # HTTP layer
│   ├── pancake-http-client.ts       # Main HTTP client (rate limiter, retries)
│   ├── request-builder.ts           # URL construction
│   └── response-parser.ts           # Response parsing
├── tools/                   # 24 MCP tools
│   ├── orders-tool.ts
│   ├── products-tool.ts
│   ├── ... (20 more)
│   └── tool-registry.ts             # Registers all tools
├── resources/               # MCP resources
│   ├── reference-data-resources.ts  # Resource data
│   └── resource-registry.ts         # Registers resources
├── shared/                  # Shared utilities
│   ├── schemas.ts                   # Zod types
│   ├── error-handler.ts             # Error classes
│   └── pagination-helpers.ts        # Pagination utilities
├── config.ts                # Configuration loading
├── server.ts                # MCP server factory
└── index.ts                 # Entry point (bootstrap)
```

### Kebab-Case Naming (Enforced)
File names use kebab-case with self-documenting names:
- ✓ `pancake-http-client.ts` (clear purpose)
- ✓ `request-builder.ts` (clear responsibility)
- ✗ `httpClient.ts` (ambiguous)
- ✗ `client.ts` (too generic)

**Rationale:** LLMs using Glob/Grep can understand file purpose immediately.

### File Size Limits (Guidelines)
- **Max 200 lines:** Code files (not documentation)
- **Already compliant:** All 35 source files under 150 lines
- **Exception:** `tool-registry.ts` (670 lines) is acceptable (single registration point)

---

## 2. TypeScript & Type Safety

### Strict Mode (Enforced)
tsconfig.json:
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

**Pre-commit check:**
```bash
npm run typecheck  # Fails if any type errors
```

### Type Annotations (Enforced)
All functions and exports must have explicit return types:

✓ **Correct:**
```typescript
export async function handleOrdersTool(
  args: z.infer<typeof ordersToolSchema>,
  client: PancakeHttpClient
): Promise<PancakeResponse<Order[]>> {
  // ...
}
```

✗ **Incorrect:**
```typescript
export async function handleOrdersTool(args, client) {
  // Missing return type, parameter types
}
```

### Zod Schema Exports (Enforced)
Every tool file must export its schema:
```typescript
export const ordersToolSchema = z.discriminatedUnion("action", [...]);
```

Used by:
1. **Tool registry:** For MCP JSON Schema generation
2. **Handler validation:** `const parsed = ordersToolSchema.parse(args)`
3. **Type inference:** `z.infer<typeof ordersToolSchema>`

---

## 3. Naming Conventions

### Variable Names
- **Config:** `PANCAKE_POS_API_KEY` (UPPER_SNAKE_CASE for constants)
- **Functions:** `handleOrdersTool` (camelCase)
- **Classes:** `PancakeHttpClient` (PascalCase)
- **Parameters:** `page_number` (snake_case, matches API schema)
- **Private fields:** `#rate_limiter` (# prefix, snake_case)

### Tool Names (Enforced)
All tool names use `manage_` prefix:
- ✓ `manage_orders`, `manage_products`, `manage_warehouses`
- ✗ `order_tool`, `createProduct`, `warehouse_crud`

Exception: Query tools use `get_` prefix:
- ✓ `get_statistics`, `get_shop_info`
- ✓ `lookup_address` (special case: address lookup)

### Parameter Names (Match Pancake API)
Must use exact API parameter names to reduce developer confusion:

✓ **Correct (matches API):**
```typescript
bill_full_name: z.string(),      // API uses snake_case
bill_phone_number: z.string(),
startDateTime: z.number().int(),  // API uses camelCase here
```

✗ **Incorrect (renamed):**
```typescript
buyerName: z.string(),            // Renamed from API
phone: z.string(),                // Renamed from API
```

---

## 4. Tool Implementation Pattern (24 Tools)

### Template (Must Follow)
Every tool file follows this exact structure:

```typescript
import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import type { PancakeResponse } from "../shared/schemas.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";

// ─── Schema Definition ───────────────────────────────────────────────
// Discriminated union with one object per action
export const ordersToolSchema = z.discriminatedUnion("action", [
  z.object({ 
    action: z.literal("list"), 
    search: z.string().optional(),
    page_number: z.number().int().optional().default(1),
  }),
  z.object({ 
    action: z.literal("get"), 
    order_id: z.number().int(),
  }),
  z.object({ 
    action: z.literal("create"), 
    bill_full_name: z.string(),
    bill_phone_number: z.string(),
    items: z.array(z.object({ ... })),
  }),
  // ... one per action
]);

// ─── Handler Function ───────────────────────────────────────────────
export async function handleOrdersTool(
  args: z.infer<typeof ordersToolSchema>,
  client: PancakeHttpClient
): Promise<unknown> {
  switch (args.action) {
    case "list": {
      const result = await client.getList("/orders", {
        search: args.search,
        page: args.page_number,
      });
      return formatPaginatedResult(result.data, result.pagination);
    }
    
    case "get": {
      const result = await client.get(`/orders/${args.order_id}`);
      return result.data;
    }
    
    case "create": {
      const result = await client.post("/orders", {
        bill_full_name: args.bill_full_name,
        items: args.items,
      });
      return result.data;
    }
    
    default:
      throw new Error(`Unknown action: ${(args as any).action}`);
  }
}
```

### Switch Statement (Exhaustiveness Check)
Always add default case to catch unknown actions:
```typescript
default:
  throw new Error(`Unknown action: ${(args as any).action}`);
```

This prevents bugs if a new action is added to schema but not handler.

### Batch Operations Exception: Single-Action-Per-Call Pattern
**Standard:** Tools handle one action per invocation (create/update/delete are separate calls).

**Exception:** `manage_orders` `batch_update` action (2026-05-06) accepts up to 50 order patches and dispatches in parallel. This is an intentional break from the pattern due to production trace analysis (single-order updates burning rate limit). Other tools should **NOT** follow this pattern without explicit justification.

### Numeric Field Coercion
When numeric fields are exposed to LLM clients (who may stringify numbers), prefer `z.coerce.number()`:

```typescript
z.object({
  page_number: z.coerce.number().int().default(1),  // Accepts "1" or 1
  price: z.coerce.number().positive(),              // Accepts "99.99" or 99.99
})
```

**Rationale:** LLM clients sometimes send stringified numbers from JSON; `coerce` tolerates both forms without breaking.

### Error Handling in Tools (Avoid Try-Catch Here)
Errors are caught at tool-registry level, NOT in individual tool handlers:

✗ **Wrong:**
```typescript
export async function handleOrdersTool(...) {
  try {
    return await client.get("/orders");
  } catch (error) {
    // Don't catch here
  }
}
```

✓ **Correct:**
```typescript
export async function handleOrdersTool(...) {
  // Let client.get() throw; registry catches it
  return await client.get("/orders");
}
```

### Dual-Schema Gotcha (CRITICAL)
Tool schemas exist in TWO places and **MUST stay in sync**:

1. **Tool file** (e.g., `orders-tool.ts`):
   ```typescript
   export const ordersToolSchema = z.discriminatedUnion("action", [
     z.object({ action: z.literal("update"), order_id: z.number(), items: z.array(...) })
   ]);
   ```

2. **Tool registry** (e.g., `tool-registry.ts:878`):
   ```typescript
   server.tool("manage_orders", "...", {
     action: z.enum([...]),
     order_id: z.number().int().optional(),
     items: z.array(...).optional(),  // ← MUST match schema above
   })
   ```

**If they diverge:** LLMs see the flat registry schema, but handler validation uses the inner discriminated union. Result: fields disappear silently during `parse()`. Example: `items` was exposed in registry but missing from UpdateAction union (2026-05-06).

**Verification:** Tests exist in `tests/tools/` to catch dual-schema mismatches (e.g., `orders-tool-schema.test.ts`).

---

## 5. Response Projection Standards

### New Tools Must Include Compact Masks
When implementing a new tool that returns large objects:

1. **Define compact mask** in `src/shared/compact-masks.ts`:
   ```typescript
   export const COMPACT_MASKS = {
     order: "id,status,bill_full_name,bill_phone_number,items[id,name,quantity,price]",
     product: "id,name,sku,category_id,images[url]",
     // Only fields relevant for LLM decision-making
   };
   ```

2. **Apply in tool handler** via `project()`:
   ```typescript
   import { project } from "../shared/response-projection.js";
   
   const result = await client.get("/products");
   return project(result.data, "compact");  // 50–85% byte reduction
   ```

3. **Document in tool description** (tool-registry.ts):
   ```
   "Compact mode (default) returns id/name/key fields only; 
    use fields[] parameter with verbosity=full for all fields."
   ```

**Current Coverage (as of 2026-05-08):**
- ✓ orders, products, warehouses, address-lookup (compact masks implemented)
- ○ combos, promotions, vouchers, CRM, ecommerce, livestream, employees, webhooks, statistics, shop-info (backlog)

---

## 5. HTTP Client Standards

### PancakeHttpClient Methods (Enforced)

All HTTP operations go through these methods:

| Method | Use Case | Response Parsing |
|--------|----------|------------------|
| `async get<T>(path, params?)` | Single resource + error check | Auto-parsed to PancakeResponse<T> |
| `async getList<T>(path, params?)` | Paginated list + error check | Auto-parsed to PancakeListResponse<T> |
| `async post<T>(path, body?)` | Create/action + error check | Auto-parsed to PancakeResponse<T> |
| `async put<T>(path, body?)` | Update + error check | Auto-parsed to PancakeResponse<T> |
| `async delete(path)` | Delete + error check | Auto-parsed to PancakeResponse<void> |
| `async getRaw<T>(path, params?)` | Unvalidated JSON (AVOID) | Returns T directly |

### Never Use getRaw() For New Code
`getRaw()` skips error validation (critical bug):

✗ **Do NOT use:**
```typescript
const data = await client.getRaw("/orders"); // No error check!
if (data.error) { // Bug: data is whole response, not wrapped
  // ...
}
```

✓ **Use instead:**
```typescript
const result = await client.get("/orders");  // Validates response.ok
if (result.error) {  // Now safe to check
  // ...
}
```

### Rate Limiting Behavior (Automatic)
- Checked before every fetch
- Tool authors don't need to do anything
- If limit exceeded, tool waits (not an error)
- No exponential backoff needed in tool code

✓ **Correct (rate limiter is transparent):**
```typescript
// 100 concurrent requests
for (let i = 0; i < 100; i++) {
  promises.push(client.get("/orders"));  // Rate limiter handles delays
}
const results = await Promise.all(promises);
```

---

## 6. Zod Schema Standards

### All Schemas Must Use Discriminated Unions (Tools)
```typescript
z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), ... }),
  z.object({ action: z.literal("get"), ... }),
  z.object({ action: z.literal("create"), ... }),
])
```

**Why:** Gives tools exact parameter requirements per action (better type checking).

### Optional vs. Required (Clear Intent)
- **Required (no .optional()):** Parameter must be provided
  ```typescript
  action: z.enum([...]),      // Required
  product_id: z.string(),     // Required
  ```

- **Optional (.optional()):** Parameter may be omitted
  ```typescript
  search: z.string().optional(),      // Optional
  description: z.string().optional(), // Optional
  ```

- **Optional with Default (.default()):** Use sparingly for pagination
  ```typescript
  page_number: z.number().int().optional().default(1),  // Defaults to 1
  ```

### Parameter Descriptions (Enforced)
All parameters must have `.describe()` for tool documentation:

```typescript
z.object({
  action: z.enum([...]).describe("Action to perform"),
  order_id: z.number().int().describe("Order ID (required for get/update)"),
  search: z.string().optional().describe("Search by phone, name, or code"),
})
```

These appear in MCP tool descriptions shown to AI assistants.

### No Custom Type Coercion (Use Zod Built-ins)
✓ **Correct (Zod built-in):**
```typescript
phone: z.string().regex(/^\d{10}$/),
price: z.number().positive(),
email: z.string().email(),
uuid: z.string().uuid(),
date: z.string().datetime(),
```

✗ **Incorrect (manual coercion):**
```typescript
phone: z.string().transform(p => p.replace(/\D/g, '')),  // Too permissive
```

---

## 7. Error Handling Standards

### PancakeApiError (Enforced Usage)
```typescript
// In response-parser.ts
if (!response.ok) {
  throw new PancakeApiError(
    "API_ERROR",
    `HTTP ${response.status}`,
    response.status
  );
}
```

### Error Propagation in Tools
Never catch and log errors in tools; let them bubble to registry:

✗ **Wrong:**
```typescript
try {
  return await client.get("/orders");
} catch (error) {
  console.error("Error:", error);  // Logs but hides from tool response
  throw error;
}
```

✓ **Correct:**
```typescript
return await client.get("/orders");  // Let registry handle
```

### formatToolError() (Auto-Applied)
Tool registry catches all errors and formats as MCP errors:
```typescript
} catch (error) {
  return formatToolError(error);  // Returns { content, isError: true }
}
```

---

## 8. Pagination Standards

### formatPaginatedResult() (Enforced for Lists)
All list operations must wrap results:

```typescript
case "list": {
  const result = await client.getList("/orders", params);
  return formatPaginatedResult(result.data, result.pagination);
}
```

### Pagination Parameters (Standardized Across All Tools)
```typescript
page_number: z.number().int().optional().describe("Page number (default 1)"),
page_size: z.number().int().optional().describe("Items per page (default 30)"),
```

All tools use same parameter names for consistency.

### Result Format (All Tools)
```typescript
{
  items: [...],
  total_items: 100,
  current_page: 1,
  page_size: 30,
  total_pages: 4,
}
```

---

## 9. API Path Patterns (Routing Rules)

### Canonical Endpoints
Always use the latest endpoint path; migrations are documented in changelog:
- `/geo/*` (CANONICAL since 2026-04-29) — address lookup (formerly `/address/*`)
- `/partners` — shipping partners (stable)

**Note:** `/address/*` redirects to 404; all new code must use `/geo/*`.

### Global Prefixes (Bypass Shop Scope)
These paths are NOT prefixed with `/shops/{shopId}/`:
- `/partners` → shipping partners (global)
- `/geo` → address lookup (global, canonical)

Example:
```typescript
// Global prefix (bypass shop scope)
await client.get("/partners");                    // /partners
await client.get("/geo/provinces");               // /geo/provinces (canonical)

// Shop-scoped (default)
await client.get("/orders");                      // /shops/{shopId}/orders
await client.get("/crm/contacts");                // /shops/{shopId}/crm/contacts
```

### Path Segment Encoding (Security)
Request builder must encode path segments:

✓ **Correct:**
```typescript
// IDs encoded to prevent traversal
new URL(`/shops/${encodeURIComponent(shopId)}/orders`, baseUrl)
```

✓ **Resolved (2026-05-10):** Path segments are now encoded via `encodePathSegments()` in `request-builder.ts` line 40-42. All URL construction goes through `buildRequestUrl()` which calls this function.

---

## 10. Configuration Standards

### Environment Variables (Required at Startup)
```bash
PANCAKE_POS_BASE_URL=https://pos.pages.fm/api/v1
PANCAKE_POS_API_KEY=<bearer-token>
PANCAKE_POS_SHOP_ID=<shop-uuid>
```

### config.ts (Single Source of Truth)
```typescript
export interface PancakeConfig {
  PANCAKE_POS_BASE_URL: string;
  PANCAKE_POS_API_KEY: string;
  PANCAKE_POS_SHOP_ID: string;
}

export function loadConfig(): PancakeConfig {
  return {
    PANCAKE_POS_BASE_URL: process.env.PANCAKE_POS_BASE_URL || "https://pos.pages.fm/api/v1",
    PANCAKE_POS_API_KEY: process.env.PANCAKE_POS_API_KEY || "",
    PANCAKE_POS_SHOP_ID: process.env.PANCAKE_POS_SHOP_ID || "",
  };
}
```

### No Hardcoded Secrets
✗ **NEVER:**
```typescript
const API_KEY = "abc123xyz";  // Hardcoded (insecure)
```

✓ **ALWAYS:**
```typescript
const API_KEY = process.env.PANCAKE_POS_API_KEY || "";  // Env var
```

---

## 11. Testing & Compilation

### Pre-Commit Checklist
- [ ] `npm run typecheck` passes (no errors)
- [ ] All Zod schemas have descriptions
- [ ] No `any` types (except in catch-all error handlers)
- [ ] No unused imports
- [ ] All tool handlers follow template pattern

### TypeScript Compilation (Before Push)
```bash
npm run typecheck
# Exit 0 if successful, non-zero if errors
```

### Known Type Issues (Acceptable)
- `any` in `formatToolError()` error handling (acceptable: catching unknowns)
- `unknown` in tool result types (acceptable: API response is dynamic)

---

## 12. Import/Export Standards

### Use ES Modules (.js extensions in imports)
✓ **Correct:**
```typescript
import { z } from "zod";
import type { PancakeConfig } from "./config.js";  // Note: .js
import { createServer } from "./server.js";
```

✗ **Incorrect:**
```typescript
import type { PancakeConfig } from "./config";  // Missing .js
```

**Rationale:** Bun + TypeScript require explicit extensions for ES module resolution.

### Type Imports (When Appropriate)
Use `import type` for type-only imports:
```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
```

---

## 13. Logging & Debugging Standards

### Logging Patterns (Current)
Only infrastructure code logs (rate limiter, retry, errors):

✓ **Acceptable:**
```typescript
console.error(`[PancakeHTTP] ${response.status} on ${redactUrl(url)}, retrying...`);
```

✗ **Not Recommended in Tools:**
```typescript
console.log(`Processing order ${order_id}`);  // Too chatty
```

### Log Redaction (Required for Secrets)
Use `redactUrl()` helper to hide API key from logs:
```typescript
redactUrl("https://pos.pages.fm/api/v1/shops/123?token=secret")
// Returns: "https://pos.pages.fm/api/v1/shops/123?token=***"
```

---

## 14. Comments & Documentation

### Code Comments (Minimal, Purposeful)
Only comment WHY, not WHAT:

✓ **Correct (explains why):**
```typescript
// Token bucket tracks TWO limits separately (per-minute + per-hour)
// because Pancake API enforces both simultaneously
private readonly minuteTokens = 1000;
private readonly hourTokens = 10000;
```

✗ **Incorrect (states obvious):**
```typescript
// Initialize minute tokens to 1000
private readonly minuteTokens = 1000;
```

### JSDoc (For Public APIs)
Export functions should have JSDoc:

```typescript
/**
 * Create and configure the Pancake POS MCP server with all tools and resources.
 * @param client - HTTP client with rate limiting
 * @returns MCP server ready for transport setup
 */
export function createServer(client: PancakeHttpClient): McpServer {
```

### Inline Comments (Sparingly)
Use for complex algorithms or non-obvious logic:

```typescript
// Exponential backoff: attempt 0→1s, attempt 1→2s, attempt 2→4s
const delay = RETRY_BASE_MS * Math.pow(2, attempt);
```

---

## 15. Code Review Checklist (Before Merge)

### Automated Checks
- [ ] `npm run typecheck` passes
- [ ] No TypeScript errors in IDE
- [ ] No unused variables/imports

### Manual Code Review
- [ ] Tool name uses `manage_` or `get_` prefix
- [ ] Schema has discriminated union per action
- [ ] All parameters have `.describe()`
- [ ] Handler follows switch/case pattern
- [ ] No try-catch in tool handler (registry handles)
- [ ] Uses `client.get/getList/post/put/delete` (not getRaw)
- [ ] List operations call `formatPaginatedResult()`
- [ ] Pagination params use `page_number` / `page_size`
- [ ] No hardcoded secrets
- [ ] API paths match Pancake API specification

### Documentation Review
- [ ] Comments explain WHY, not WHAT
- [ ] Tool description in registry matches behavior
- [ ] Parameter descriptions are clear
- [ ] Examples provided for complex actions

---

## 16. Known Bugs & Deprecations

### Critical (Must Fix)
| Issue | Location | Fix | Priority |
|-------|----------|-----|----------|
| Path traversal | `request-builder.ts` | Encode path segments with `encodeURIComponent()` | HIGH |
| getRaw() no error check | `address-lookup-tool.ts` | Use `client.get()` instead | HIGH |

### Minor (Consider)
| Issue | Location | Fix | Priority |
|-------|----------|-----|----------|
| Discount bounds | `promotions-tool.ts` | Add `.min(0).max(100)` to discount_value | LOW |
| promotions UpdateAction | `promotions-tool.ts` | Add `applicable_product_ids` to UpdateAction schema | LOW |

---

## 17. Best Practices Summary

### DO
- Use Zod discriminated unions for tool schemas
- Follow the tool handler template exactly
- Use exact Pancake API parameter names
- Add descriptions to all parameters
- Let errors propagate to registry
- Use formatPaginatedResult() for lists
- Add comments explaining WHY
- Run typecheck before committing

### DON'T
- Use `any` types (except error handlers)
- Catch errors in tool handlers
- Use getRaw() for new code
- Hardcode secrets in source
- Rename API parameters
- Skip parameter descriptions
- Add unnecessary console.log
- Commit if typecheck fails

