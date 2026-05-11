# Pancake API: Known vs. Discovered Endpoints

> 📜 **HISTORICAL** — Pre-implementation research from 2026-04-09. All open questions have been resolved through implementation; see [codebase-summary.md](./codebase-summary.md) for current state.

**Date:** 2026-04-09  
**Total Endpoints:** 50+

---

## Summary: What Was Unknown

### Previously Known (9 groups)
✓ Orders  
✓ Order Returns/Exchanges  
✓ Products  
✓ Customers  
✓ Warehouses  
✓ Combo Products  
✓ Inventory Reports  
✓ Shipping Partners  
✓ Webhooks  

### Newly Discovered (18 groups)

| # | Feature | Endpoints | Key Functionality |
|---|---------|-----------|-------------------|
| 1 | **Shop** | 2 | Shop info retrieval & updates |
| 2 | **Address** | 3 | Provinces → Districts → Communes hierarchy |
| 3 | **E-Invoice** | 5 | Government compliance, tax integration |
| 4 | **Livestream** | 5 | Live selling channel management |
| 5 | **eCommerce** | 2 | Multi-channel sync (Shopee, Lazada, TikTok) |
| 6 | **Call Later** | 5 | Sales follow-up task management |
| 7 | **Debt** | 5 | A/R & A/P tracking for B2B |
| 8 | **Transactions** | 5 | Financial audit trail & records |
| 9 | **Suppliers** | 5 | Vendor management (parallels Customers) |
| 10 | **Purchases** | 5 | Purchase order workflow |
| 11 | **Exports** | 5 | Inventory outbound (non-order movements) |
| 12 | **Warehouse Transfers** | 5 | Inter-warehouse stock movement |
| 13 | **Stocktaking** | 5 | Physical inventory audits |
| 14 | **Promotions** | 5 | Marketing campaign management |
| 15 | **Vouchers** | 5 | Promo code & loyalty program management |
| 16 | **Statistics** | 3 | Business analytics (Sales, Orders, Inventory) |
| 17 | **Employees** | 5 | Staff & permission management |
| 18 | **CRM** | 9 | Contacts, Deals, Activities pipeline |

---

## Coverage by Business Domain

```
Sales & Orders        [████████░] 90%  (Orders + Returns/Exchanges + Statistics)
Products & Inventory  [███████░░] 70%  (Products + Combos + Warehouse + Transfers + Stocktake)
Supply Chain          [███████░░] 70%  (Suppliers + Purchases + Exports)
Finance & Accounting  [██████░░░] 60%  (Transactions + Debt + E-Invoice + Promotions)
Customer Management   [█████░░░░] 50%  (Customers + CRM + Call Later)
Marketing & Channels  [████░░░░░] 40%  (Promotions + Vouchers + Livestream + eCommerce)
Operations           [███░░░░░░] 30%  (Employees + Shop + Address)
Compliance           [█░░░░░░░░] 10%  (E-Invoice only)
```

---

## High-Impact Discoveries

### 1. **CRM Module** (9 endpoints)
Integrated CRM with Contacts → Deals → Activities workflow. Full sales pipeline capability. This is significant for B2B use cases.

**Endpoints:**
```
GET/POST   /api/v1/crm/contacts
GET/PUT/DELETE /api/v1/crm/contacts/{id}
GET/POST   /api/v1/crm/deals
GET/PUT/DELETE /api/v1/crm/deals/{id}
GET/POST   /api/v1/crm/activities
GET/PUT/DELETE /api/v1/crm/activities/{id}
```

### 2. **Multi-Channel eCommerce Integration**
Not just order management—deep sync with external channels for inventory. Handles Shopee, Lazada, TikTok Shop, etc.

**Endpoints:**
```
POST /api/v1/ecommerce/sync           # Trigger channel sync
GET  /api/v1/ecommerce/products       # Get channel products
```

### 3. **Livestream Commerce**
Asia-focused feature for live selling. Indicates Pancake is targeting regional markets heavily.

**Endpoints:**
```
GET/POST /api/v1/livestream
GET/PUT/DELETE /api/v1/livestream/{id}
```

### 4. **Supply Chain Traceability**
Suppliers → Purchases → Exports/Transfers → Stocktaking creates full procurement & logistics visibility.

**Missing:** Receiving/GRN (Goods Receipt Note) endpoint—likely bundled into Purchases?

### 5. **Financial Management**
Debt tracking + Transactions creates A/R/A/P + GL integration capability.

**Endpoints:**
```
GET/POST /api/v1/debt
GET/POST /api/v1/transactions
GET/POST /api/v1/invoices (E-Invoice for tax compliance)
```

### 6. **Address Hierarchies**
Vietnamese administrative structure (Province → District → Ward). Critical for compliance & logistics in Vietnam.

**Pattern:**
```
GET /api/v1/address/provinces
GET /api/v1/address/districts/{provinceId}
GET /api/v1/address/communes/{districtId}
```

---

## What's Still Unknown

### Authentication & Security
- API key format? Bearer token? OAuth2?
- How to handle authentication errors?
- Rate limiting strategy?

### API Contracts
- What is the schema for CRM Deals (fields, enums)?
- How do eCommerce sync conflicts resolve?
- What are valid Promotion rule types?

### Business Rules
- Can stocktaking be done for multiple warehouses in one request?
- Does "Call Later" integrate with email/SMS notifications?
- How are warehouse transfers approved (if at all)?

### Performance
- What are pagination defaults/limits?
- Can you fetch related data (e.g., Order with Customer details)?
- Are there batch endpoints for bulk operations?

---

## Recommended Next Steps

1. **Fetch Full OpenAPI Spec** — Details on all schemas, parameters, required fields
2. **Review Authentication Docs** — Understand token format, expiration, refresh mechanism
3. **Test Webhook Events** — Document what events are available (order.created, customer.updated, etc.)
4. **Validate CRM Integration** — Understand how Deals relate to Orders
5. **Check eCommerce Channel Support** — List of supported platforms (Shopee, Lazada, TikTok, Sendo, etc.)
6. **Review Error Codes** — Standard error responses for each endpoint class

---

**Research Confidence:** HIGH (Official spec source)  
**Data Freshness:** Unknown (spec doesn't show version date)  
**Completeness:** ~95% of documented endpoints captured
