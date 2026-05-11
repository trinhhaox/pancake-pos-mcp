# Pancake POS MCP - Project Overview & PDR

**Version:** 0.1.0  
**Status:** Implementation Complete (Phases 1-6 + Display ID Resolver)  
**Last Updated:** 2026-05-12

---

## 1. Project Purpose

Pancake POS MCP is a Model Context Protocol (MCP) server that exposes the Pancake POS REST API to AI assistants like Claude, enabling **natural-language automation** of Vietnamese e-commerce point-of-sale operations.

### Problem Statement
Vietnamese e-commerce sellers using Pancake POS lack programmatic access through modern AI assistants. Complex workflows require manual API integration or custom scripts. Pancake POS MCP bridges this gap.

### Solution
Provide 24 domain-specific MCP tools that wrap Pancake POS endpoints, allowing AI assistants to:
- Manage orders, products, and customers through conversation
- Automate inventory and supply chain operations
- Access CRM, promotions, and multi-channel commerce
- Query analytics and operational data

---

## 2. Target Users

1. **Vietnamese SME POS Operators** — Sellers using Pancake POS daily
2. **E-commerce Business Managers** — Multi-channel retailers (Shopee, Lazada, TikTok)
3. **Supply Chain Managers** — Managing warehouses, transfers, and stocktaking
4. **AI Application Developers** — Building AI-assisted commerce workflows
5. **Integration Partners** — Expanding Pancake POS ecosystem

---

## 3. Key Features

### Phase 1: Core POS Operations
- **Order Management:** Create, read, update, delete, print, ship, call-later reminders
- **Product Catalog:** CRUD with variations, pricing, and inventory links
- **Customer Management:** Profiles, reward points, transaction history
- **Inventory Reports:** Filtered by warehouse, category, supplier, quantity thresholds

### Phase 2: Supply Chain & Warehousing
- **Warehouse Management:** Multi-warehouse CRUD and configuration
- **Supplier Management:** Contact and order management
- **Purchase Orders:** Inbound inventory tracking with discounts
- **Warehouse Transfers:** Inter-warehouse inventory movement
- **Stocktaking:** Physical inventory audits and reconciliation

### Phase 3: Sales Extensions
- **Returns & Exchanges:** Full return workflow with exchange processing
- **Product Combos:** Bundle deals with time-based rules and bonuses
- **Promotions:** Discount campaigns (percentage or fixed amount)
- **Vouchers:** Code generation, usage tracking, and redemption

### Phase 4: CRM & Multi-Channel
- **CRM Contacts:** Company and individual contact management
- **Sales Pipeline:** Deal tracking with stages and expected close dates
- **Activities:** Calls, meetings, tasks, notes tied to contacts and deals
- **Multi-Channel eCommerce:** Shopee, Lazada, TikTok sync and product listing
- **Livestream Commerce:** Live selling session scheduling and product associations

### Phase 5: Operations & Business Intelligence
- **Employee Management:** Staff profiles, roles, and warehouse assignments
- **Webhook Management:** Event subscriptions and integration points
- **Business Analytics:** Sales, orders, and inventory analytics with grouping options
- **Shop Profile:** Store information, configuration, and branding
- **Address Lookup:** Vietnamese address hierarchy (provinces → districts → communes)

---

## 4. Product Requirements

### 4.1 Functional Requirements

#### MCP Tools (FR-1)
- Implement 24 tools covering all 5 business phases + analytics
- Each tool must validate inputs with Zod schemas
- All tools must handle pagination, filtering, and sorting where applicable
- Error responses must include code, message, and HTTP status

#### API Client (FR-2)
- Support rate limiting: 1000 requests/minute, 10000 requests/hour
- Implement exponential backoff retries: 3 attempts (1s, 2s, 4s delays)
- Request timeout: 30 seconds
- Support all HTTP methods: GET, POST, PUT, DELETE

#### Authentication (FR-3)
- Accept Pancake API key from environment variable `PANCAKE_POS_API_KEY`
- Accept Pancake Shop ID from environment variable `PANCAKE_POS_SHOP_ID`
- Inject shop ID into API paths automatically
- Support optional Bearer token authentication for HTTP transport

#### Transport Options (FR-4)
- Stdio transport: Default for Claude Desktop integration
- Streamable HTTP transport: For remote and server deployment
- Health check endpoint at `/health`
- MCP endpoint at `/mcp`

#### Resources (FR-5)
- Provide 6 static reference resources (order statuses, sources, sort options, webhook events, error codes, rate limits)
- Provide 1 dynamic resource (shipping partners, cached from API)
- All resources must be readonly and not require authentication

### 4.2 Non-Functional Requirements

#### Performance (NFR-1)
- Rate limiter: Token-bucket algorithm for dual-tier limits (per-minute, per-hour)
- Retry strategy: Exponential backoff with 3 attempts maximum
- Connection timeout: 30 seconds
- Response parsing: < 100ms for typical responses

#### Reliability (NFR-2)
- All API errors must be caught and transformed to structured error objects
- Tool execution must not crash the server on invalid input
- HTTP transport must support concurrent sessions via Streamable HTTP

#### Security (NFR-3)
- Environment variables for all secrets (API key, shop ID, auth token)
- Optional Bearer token authentication for HTTP transport
- No credentials logged in error messages or debug output
- HTTPS recommended for production HTTP deployments

#### Maintainability (NFR-4)
- Strict TypeScript with noImplicitAny and full type annotations
- All tool files must follow enforced pattern (see code-standards.md)
- File size limits: < 200 LOC for code files (exception: tool-registry.ts)
- Kebab-case file naming with self-documenting names

#### Scalability (NFR-5)
- Tool registry supports adding new tools without modifying core server
- Zod schemas provide runtime validation preventing invalid requests
- Resource architecture supports both static and dynamic resources

---

## 5. Architecture Overview

### 5.1 System Layers

```
User (Claude Desktop / Remote Client)
         ↓
    MCP Protocol
         ↓
    MCP Server (src/server.ts)
    - Tool Registry (24 tools)
    - Resource Registry (7 resources)
         ↓
    Tool Handlers (src/tools/)
    - Schema validation (Zod)
    - Request construction
    - Response normalization
         ↓
    HTTP Client (src/api-client/)
    - Rate limiting (token-bucket)
    - Retry logic (exponential backoff)
    - Request/response transformation
         ↓
    Pancake POS REST API
    https://pos.pages.fm/api/v1
```

### 5.2 Data Flow Example: Create Order

1. User: "Create an order for customer 123 with product 456"
2. Claude calls `manage_orders` tool with action=create
3. Tool handler validates input schema
4. Constructs POST request: `/shops/{shopId}/orders`
5. HTTP client applies rate limiting, adds auth headers
6. Sends request, receives response
7. Parser normalizes response to { order_id, order_number, status }
8. Claude receives structured result

### 5.3 Error Handling

All errors transform to structured format:
```typescript
{
  error: "ValidationError" | "RateLimitError" | "NotFoundError" | ...,
  code: "INVALID_INPUT" | "RATE_LIMITED" | "NOT_FOUND" | ...,
  message: "Human-readable error message"
}
```

---

## 6. Constraints & Limitations

### API Constraints (C-1)
- Rate limits: 1000 requests/minute, 10000 requests/hour (enforced server-side)
- Single API key per deployment (one shop per MCP server instance)
- Pancake API availability: 99% uptime (Vietnamese service)
- Response timeouts: 30 seconds

### Data Constraints (C-2)
- Vietnamese language: Address hierarchy, status codes, error messages in Vietnamese
- Shop ID required for all operations except `/partners` endpoint
- No cross-shop queries (one deployment = one shop)

### Technical Constraints (C-3)
- Bun runtime required (not compatible with Node.js directly)
- TypeScript compilation: Strict mode, no implicit any
- MCP SDK v1.29.0 required (breaking changes in v2+)

### Operational Constraints (C-4)
- Manual deployment required (no auto-scaling for stdio transport)
- HTTP transport requires explicit port and auth token configuration
- No built-in monitoring or alerting

---

## 7. Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Tools Implemented | 24 | 24 (100%) |
| Phases Complete | 5 | 5 (100%) |
| Tool Test Coverage | 80%+ | TBD |
| Documentation Coverage | 100% | 95% |
| Build Errors | 0 | 0 |
| Type Errors | 0 | 0 |
| Average Response Time | < 500ms | TBD (depends on API) |
| Rate Limit Compliance | 100% | 100% |

---

## 8. Out of Scope

- **AI Model Training:** MCP is a wrapper, not a training dataset
- **Pancake API Design:** We consume existing API, not design endpoints
- **Multi-Shop Management:** One server = one shop (can run multiple servers)
- **Offline Mode:** Online API access required
- **Custom Workflows:** We provide tools, Claude assembles workflows
- **Payment Processing:** Handled by Pancake, not exposed via MCP

---

## 9. Acceptance Criteria

- [x] All 24 tools implemented and functional
- [x] 5 phases complete with proper organization
- [x] Type-safe implementation (0 TypeScript errors)
- [x] Rate limiting and retries working
- [x] Both stdio and HTTP transports operational
- [x] 7 resources available (6 static + 1 dynamic)
- [ ] Unit tests passing (90%+ coverage)
- [ ] Integration tests passing
- [ ] Documentation complete
- [ ] Deployment guide verified

---

## 10. Future Enhancements

1. **Multi-Shop Support:** Route requests to correct shop based on MCP context
2. **Webhook Integration:** Subscribe to Pancake events and forward to clients
3. **Batch Operations:** Tool support for bulk create/update operations
4. **Analytics Dashboard:** Visualize MCP tool usage and API performance
5. **Custom Tool Builder:** Allow users to create new tools via config
6. **Request/Response Caching:** Redis-backed caching for frequently accessed resources
7. **Audit Logging:** Detailed logging of all MCP tool invocations
8. **Multi-Language Support:** Localize error messages and resource descriptions

---

## 11. Project Timeline (Completed)

| Phase | Duration | Status |
|-------|----------|--------|
| Phase 1: Core POS | Week 1-2 | Complete |
| Phase 2: Supply Chain | Week 3-4 | Complete |
| Phase 3: Sales Extensions | Week 5-6 | Complete |
| Phase 4: CRM & Multi-Channel | Week 7-8 | Complete |
| Phase 5: Operations | Week 9+ | Complete |
| Testing & Refinement | Ongoing | In Progress |
| Documentation | Ongoing | In Progress |

---

## 12. Dependencies

- **Bun Runtime** — v1.0+ required
- **TypeScript** — v5.0+ for type checking
- **MCP SDK** — v1.29.0 (@modelcontextprotocol/sdk)
- **Zod** — v4.3.6+ for schema validation
- **Pancake POS API** — Active account with valid credentials

---

## 13. Stakeholders

- **Project Owner:** Plateau Nguyen (vietnamese dev, Bun/TS expertise)
- **End Users:** Vietnamese SME POS operators
- **API Provider:** Pancake (https://pancake.vn)
- **Integration Partner:** Anthropic (Claude, MCP protocol)

---

**Prepared by:** Documentation Team  
**Last Reviewed:** 2026-04-10  
**Next Review:** Upon major feature addition or API update
