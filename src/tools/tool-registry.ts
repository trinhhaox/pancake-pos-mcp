import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatToolError } from "../shared/error-handler.js";
import { ordersToolSchema, handleOrdersTool } from "./orders-tool.js";
import { ORDER_SORT_VALUES, ORDER_SORT_DESCRIPTION } from "../shared/sort-options.js";
import { productsToolSchema, handleProductsTool } from "./products-tool.js";
import { customersToolSchema, handleCustomersTool } from "./customers-tool.js";
import { inventoryToolSchema, handleInventoryTool } from "./inventory-tool.js";
import { warehousesToolSchema, handleWarehousesTool } from "./warehouses-tool.js";
import { suppliersToolSchema, handleSuppliersTool } from "./suppliers-tool.js";
import { purchasesToolSchema, handlePurchasesTool } from "./purchases-tool.js";
import { transfersToolSchema, handleTransfersTool } from "./transfers-tool.js";
import { stocktakingToolSchema, handleStocktakingTool } from "./stocktaking-tool.js";
import { returnsToolSchema, handleReturnsTool } from "./returns-tool.js";
import { combosToolSchema, handleCombosTool } from "./combos-tool.js";
import { promotionsToolSchema, handlePromotionsTool } from "./promotions-tool.js";
import { vouchersToolSchema, handleVouchersTool } from "./vouchers-tool.js";
import { crmContactsToolSchema, handleCrmContactsTool } from "./crm-contacts-tool.js";
import { crmDealsToolSchema, handleCrmDealsTool } from "./crm-deals-tool.js";
import { crmActivitiesToolSchema, handleCrmActivitiesTool } from "./crm-activities-tool.js";
import { ecommerceToolSchema, handleEcommerceTool } from "./ecommerce-tool.js";
import { livestreamToolSchema, handleLivestreamTool } from "./livestream-tool.js";
import { employeesToolSchema, handleEmployeesTool } from "./employees-tool.js";
import { webhooksToolSchema, handleWebhooksTool } from "./webhooks-tool.js";
import { statisticsToolSchema, handleStatisticsTool } from "./statistics-tool.js";
import { shopInfoToolSchema, handleShopInfoTool } from "./shop-info-tool.js";
import { addressLookupToolSchema, handleAddressLookupTool } from "./address-lookup-tool.js";
import { analyticsToolSchema, handleAnalyticsTool } from "./analytics-tool.js";

/**
 * Register all Pancake POS tools with the MCP server.
 * Uses `tool()` with raw shape for proper JSON Schema generation,
 * then validates with discriminated union in handler for precise runtime checking.
 */
export function registerAllTools(server: McpServer, client: PancakeHttpClient): void {
  // ── Phase 1: Core POS ──────────────────────────────────────────────────────

  server.tool(
    "manage_orders",
    `Manage orders in Pancake POS. Actions: list (filters/pagination/sort/projection), get (by ID), create, update (items replacement when status===0), batch_update (1 call -> N order updates), delete (status===0), print, ship, call_later.

BATCH_UPDATE — use when processing many orders at once (payment confirmations, status flips, bulk retag):
  batch_update({ updates: [
    { order_id: 411, note: "Đã ck" },
    { order_id: 412, note: "Đã ck" },
    { order_id: 413, status: 1 },
  ]})
Up to 50 per call. Each item needs order_id + ≥1 updatable field (note/status/tags/note_print). Returns per-item ok/error. Prefer this over N parallel update calls — counts as 1 tool action upstream.


RESPONSE INCLUDES SERVER-SIDE AGGREGATIONS (no extra call):
- aggs.cod.value          → total COD across filtered orders (VND)
- aggs.shipping_fee.value → total shipping fee
- aggs.prepaid.value      → total prepaid
- aggs.partner_fee.value  → total partner fee
- aggs.status.buckets     → [{key: status_code, doc_count}] count per status
For revenue/total/count queries: read aggs instead of looping pagination.

ANALYTICS PATTERNS (use list with sort+limit+fields, NOT pagination loop):
- Top order by total in last year:
    list({ option_sort: "order_valuation_desc", page_size: 1, fields: ["id","total_price","bill_full_name","inserted_at"], startDateTime, endDateTime })
- Newest order of customer:
    list({ customer_id, option_sort: "inserted_at_desc", page_size: 1, fields: ["id","total_price","inserted_at"] })
- Top 10 by item count this month:
    list({ option_sort: "product_quantity_desc", page_size: 10, fields: ["id","product_quantity","total_price"], startDateTime, endDateTime })`,
    {
      action: z.enum(["list", "get", "create", "update", "batch_update", "delete", "print", "ship", "call_later"]).describe("Action to perform"),
      order_id: z.coerce.number().int().optional().describe("Order ID (required for get/update/delete/print/ship)"),
      updates: z
        .array(
          z.object({
            order_id: z.coerce.number().int(),
            note: z.string().optional(),
            status: z.coerce.number().int().optional(),
            tags: z.array(z.coerce.number().int()).optional(),
            note_print: z.string().optional(),
          }),
        )
        .optional()
        .describe("Required for batch_update. Up to 50 per-order patches."),
      // list params
      search: z.string().optional().describe("Search by phone, name, note, or order code"),
      filter_status: z.array(z.coerce.number().int()).optional().describe("Filter by status codes"),
      customer_id: z.string().optional().describe("Filter list by customer UUID (e.g. newest order of customer)"),
      include_removed: z.literal(1).optional().describe("Set to 1 to include deleted orders in list"),
      updateStatus: z
        .string()
        .optional()
        .describe("Date-field filter: inserted_at, updated_at, paid_at, etc."),
      order_sources: z
        .array(z.array(z.string()))
        .optional()
        .describe("Filter by source: [[source_code, account_id]]"),
      page_number: z.coerce.number().int().optional().describe("Page number (default 1)"),
      page_size: z.coerce.number().int().optional().describe("Items per page (default 30)"),
      startDateTime: z.coerce.number().int().optional().describe("Start date unix timestamp"),
      endDateTime: z.coerce.number().int().optional().describe("End date unix timestamp"),
      option_sort: z.enum(ORDER_SORT_VALUES).optional().describe(ORDER_SORT_DESCRIPTION),
      fields: z
        .array(z.string())
        .optional()
        .describe(
          'Project specific fields (slashes payload ~95%). Example: ["id","total_price","bill_full_name","inserted_at"].',
        ),
      // create/update params
      bill_full_name: z.string().optional().describe("Buyer name (required for create)"),
      bill_phone_number: z.string().optional().describe("Buyer phone (required for create)"),
      items: z.array(z.object({
        quantity: z.coerce.number().int().min(1),
        variation_id: z.string(),
        product_id: z.string(),
        discount_each_product: z.coerce.number().optional(),
        is_bonus_product: z.boolean().optional(),
        note: z.string().optional(),
      })).optional().describe(
        "Order items. Required for create. On update, replaces items[] (allowed only when order status === 0 — pre-check enforces).",
      ),
      warehouse_id: z.string().optional().describe("Warehouse UUID"),
      shipping_address: z.record(z.string(), z.unknown()).optional().describe(
        "Shipping address. Fields: full_name, phone_number, address (street). Location: OLD format (province_id+district_id+commune_id) or NEW format post-2025-07-01 (new_province_id+new_commune_id; no district level). Server detects format by ID prefix.",
      ),
      note: z.string().optional(),
      status: z.coerce.number().int().optional().describe("Status for update"),
      tags: z.array(z.coerce.number().int()).optional(),
      // update — financial fields (note: customer_pay_fee is silently dropped by api_key auth, do not send)
      shipping_fee: z.coerce.number().optional().describe("Shipping fee (update). Some shops require sending is_free_shipping together — verify-after-update will warn on silent-drop."),
      partner_fee: z.coerce.number().optional().describe("Partner shipping fee (update)."),
      is_free_shipping: z.boolean().optional().describe("Free shipping flag (create/update)."),
      total_discount: z.coerce.number().optional().describe(
        "Total order discount (create/update). May be silently dropped or recomputed under api_key auth — verify-after-update warns. Workaround: per-item discount.",
      ),
      surcharge: z.coerce.number().optional().describe(
        "Order surcharge (create/update). May be silently dropped under api_key auth — verify-after-update warns.",
      ),
      note_print: z.string().optional().describe("Note printed on order receipt (create/update/ship)."),
      received_at_shop: z.boolean().optional().describe("Customer pickup at shop (create/update)."),
      custom_id: z.string().optional().describe("Custom order ID (create/update)."),
      bill_email: z.string().optional().describe("Buyer email (create/update)."),
      customer_pay_fee: z.boolean().optional().describe("Customer pays shipping fee (create/ship)."),
      // ship params (partner_id accepts scalar for ship, or array of ints for list-filter)
      partner_id: z
        .union([z.coerce.number().int(), z.array(z.coerce.number().int())])
        .optional()
        .describe("Scalar number for ship (required); array of partner IDs to filter list"),
      service_type_id: z.coerce.number().int().optional().describe("Ship: service type (e.g. 2=standard)"),
      pick_shift: z.array(z.coerce.number().int()).optional().describe("Ship: pickup shift codes"),
      required_note: z.string().optional().describe("Ship: delivery requirement note"),
      // call_later params
      order_ids: z.array(z.string()).optional().describe("Order IDs for call_later"),
      needs_call_at: z.string().optional().describe("ISO datetime for callback"),
      phone_number: z.string().optional(),
      notice_created: z.string().optional(),
      need_notify_users: z.array(z.string()).optional(),
      // print params
      template: z.string().optional().describe("Print template: default, a5, label"),
      // response projection
      verbosity: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          "Response detail level for list/get/create/update. 'compact' (default) returns essential fields only (~85% smaller). 'full' returns raw Pancake response.",
        ),
    },
    async (args) => {
      try {
        const parsed = ordersToolSchema.parse(args);
        const result = await handleOrdersTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_products",
    "Manage products in Pancake POS. Actions: list (search/filters), get (by UUID), create, update, delete, list_variations, create_variation.",
    {
      action: z.enum(["list", "get", "create", "update", "delete", "list_variations", "create_variation"]).describe("Action to perform"),
      product_id: z.string().optional().describe("Product UUID (required for get/update/delete/list_variations/create_variation)"),
      search: z.string().optional().describe("Search by name, custom_id, or barcode"),
      category_ids: z.array(z.coerce.number().int()).optional(),
      tag_ids: z.array(z.coerce.number().int()).optional().describe("List filter: tag IDs"),
      type: z
        .enum(["product", "combo", "service"])
        .optional()
        .describe("List filter: product type"),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Product name (required for create)"),
      custom_id: z.string().optional().describe("Custom product ID / SKU"),
      brand_id: z.coerce.number().int().optional().describe("Brand ID (create/update)"),
      description: z.string().optional(),
      retail_price: z.coerce.number().optional(),
      wholesale_price: z.coerce.number().optional().describe("Wholesale price (create / create_variation)"),
      last_imported_price: z.coerce.number().optional().describe("Cost price (create)"),
      images: z.array(z.string()).optional(),
      keyword: z.string().optional().describe("Variation name (required for create_variation)"),
      barcode: z.string().optional(),
      weight: z.coerce.number().optional(),
      variations: z
        .array(
          z.object({
            keyword: z.string(),
            custom_id: z.string().optional(),
            retail_price: z.coerce.number().optional(),
            wholesale_price: z.coerce.number().optional(),
            weight: z.coerce.number().optional(),
            barcode: z.string().optional(),
            fields: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .optional()
              .describe("Variation attributes like Color, Size"),
          }),
        )
        .optional()
        .describe("create: nested variations to create alongside the product"),
      fields: z
        .array(z.object({ name: z.string(), value: z.string() }))
        .optional()
        .describe("create_variation: variation attribute fields (name/value pairs)"),
      verbosity: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          "Response detail level for list/get/list_variations. 'compact' (default) strips images/SEO/audit fields (~70% smaller). 'full' returns raw Pancake response.",
        ),
    },
    async (args) => {
      try {
        const parsed = productsToolSchema.parse(args);
        const result = await handleProductsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_customers",
    "Manage customers in Pancake POS. Actions: list (search), get (by UUID), create, update, delete, reward_history, add_note.",
    {
      action: z.enum(["list", "get", "create", "update", "delete", "reward_history", "add_note"]).describe("Action to perform"),
      customer_id: z.string().optional().describe("Customer UUID (required for get/update/delete/reward_history; optional for add_note when using conversation_id)"),
      search: z.string().optional().describe("Search by name, phone, or email"),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Customer name (required for create)"),
      phone_numbers: z.array(z.string()).optional().describe("Phone numbers (required for create)"),
      emails: z.array(z.string()).optional(),
      gender: z.enum(["male", "female", "other"]).optional(),
      date_of_birth: z.string().optional(),
      reward_point: z.coerce.number().optional(),
      tags: z.array(z.string()).optional(),
      is_block: z.boolean().optional().describe("Block this customer (create/update)"),
      level_id: z.string().optional().describe("Customer level UUID (create/update)"),
      shop_customer_addresses: z
        .array(
          z.object({
            country_code: z.coerce.number().optional(),
            province_id: z.string(),
            district_id: z.string(),
            commune_id: z.string().optional(),
            address: z.string(),
            full_name: z.string(),
            phone_number: z.string(),
          }),
        )
        .optional()
        .describe("create: customer addresses"),
      message: z.string().optional().describe("Note message (required for add_note)"),
      order_id: z.coerce.number().int().optional().describe("Related order ID for add_note"),
      conversation_id: z.string().optional().describe("add_note: conversation ID (alternate to customer_id)"),
      page_id: z.string().optional().describe("add_note: page ID (alternate to customer_id)"),
      images: z
        .array(z.object({ url: z.string(), name: z.string().optional() }))
        .optional()
        .describe("add_note: image attachments"),
    },
    async (args) => {
      try {
        const parsed = customersToolSchema.parse(args);
        const result = await handleCustomersTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_inventory",
    "Manage inventory in Pancake POS. Actions: report (inventory report with filters by warehouse, category, supplier, quantity range).",
    {
      action: z.enum(["report"]).describe("Action to perform"),
      warehouse_ids: z.array(z.string()).optional().describe("Filter by warehouse UUIDs"),
      category_ids: z.array(z.coerce.number().int()).optional(),
      supplier_ids: z.array(z.string()).optional(),
      brand_ids: z.array(z.coerce.number().int()).optional(),
      min_quantity: z.coerce.number().optional(),
      max_quantity: z.coerce.number().optional(),
      include_hidden: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = inventoryToolSchema.parse(args);
        const result = await handleInventoryTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  // ── Phase 2: Supply Chain ──────────────────────────────────────────────────

  server.tool(
    "manage_warehouses",
    "Manage warehouses in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      warehouse_id: z.string().optional().describe("Warehouse UUID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Warehouse name (required for create)"),
      phone_number: z.string().optional(),
      address: z.string().optional(),
      province_id: z.string().optional(),
      district_id: z.string().optional(),
      commune_id: z.string().optional(),
      allow_create_order: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = warehousesToolSchema.parse(args);
        const result = await handleWarehousesTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_suppliers",
    "Manage suppliers in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      supplier_id: z.string().optional().describe("Supplier ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Supplier name (required for create)"),
      phone_number: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      description: z.string().optional(),
    },
    async (args) => {
      try {
        const parsed = suppliersToolSchema.parse(args);
        const result = await handleSuppliersTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_purchases",
    "Manage purchase orders in Pancake POS. Actions: list, get, create, update, delete. Links suppliers to inventory inbound stock.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      purchase_id: z.string().optional().describe("Purchase order ID (required for get/update/delete)"),
      supplier_id: z.string().optional().describe("Supplier ID (required for create; filter for list)"),
      warehouse_id: z.string().optional().describe("Warehouse UUID (required for create; filter for list)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      startDateTime: z.coerce.number().int().optional(),
      endDateTime: z.coerce.number().int().optional(),
      items: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int(), price: z.coerce.number().optional() })).optional().describe("Purchase items"),
      note: z.string().optional(),
      discount: z.coerce.number().optional(),
      expected_at: z.string().optional(),
      status: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = purchasesToolSchema.parse(args);
        const result = await handlePurchasesTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_transfers",
    "Manage warehouse-to-warehouse stock transfers in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      transfer_id: z.string().optional().describe("Transfer ID (required for get/update/delete)"),
      source_warehouse_id: z.string().optional().describe("Source warehouse UUID (required for create)"),
      destination_warehouse_id: z.string().optional().describe("Destination warehouse UUID (required for create)"),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      items: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int() })).optional(),
      note: z.string().optional(),
      status: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = transfersToolSchema.parse(args);
        const result = await handleTransfersTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_stocktaking",
    "Manage stocktaking (physical inventory counts) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      stocktaking_id: z.string().optional().describe("Stocktaking ID (required for get/update/delete)"),
      warehouse_id: z.string().optional().describe("Warehouse UUID (required for create; filter for list)"),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      items: z.array(z.object({ variation_id: z.string(), actual_quantity: z.coerce.number().int() })).optional().describe("Items with actual counted quantities"),
      note: z.string().optional(),
      status: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = stocktakingToolSchema.parse(args);
        const result = await handleStocktakingTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  // ── Phase 3: Sales Extensions ──────────────────────────────────────────────

  server.tool(
    "manage_returns",
    "Manage order returns and exchanges in Pancake POS. Actions: list, get, create, update, delete. Supports exchange flow (return + new items).",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      return_id: z.string().optional().describe("Return ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      order_id_to_returned: z.coerce.number().int().optional().describe("Original order ID (required for create)"),
      returned_items: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int(), price: z.coerce.number().optional() })).optional(),
      warehouse_id: z.string().optional().describe("Destination warehouse for returned stock"),
      discount: z.coerce.number().optional(),
      returned_fee: z.coerce.number().optional(),
      note: z.string().optional(),
      is_exchange: z.boolean().optional(),
      exchange_items: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int(), price: z.coerce.number().optional() })).optional(),
      status: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = returnsToolSchema.parse(args);
        const result = await handleReturnsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_combos",
    "Manage product combos (bundled deals) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      combo_id: z.string().optional().describe("Combo ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Combo name (required for create)"),
      discount_amount: z.coerce.number().optional(),
      is_free_shipping: z.boolean().optional(),
      variations: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int(), discount_amount: z.coerce.number().optional() })).optional(),
      bonus_products: z.array(z.object({ variation_id: z.string(), quantity: z.coerce.number().int() })).optional(),
      start_time: z.coerce.number().int().optional(),
      end_time: z.coerce.number().int().optional(),
      order_sources: z.array(z.coerce.number().int()).optional(),
    },
    async (args) => {
      try {
        const parsed = combosToolSchema.parse(args);
        const result = await handleCombosTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_promotions",
    "Manage promotions (discounts) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      promotion_id: z.string().optional().describe("Promotion ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Promotion name (required for create)"),
      discount_type: z.enum(["percent", "amount"]).optional(),
      discount_value: z.coerce.number().optional(),
      minimum_order_value: z.coerce.number().optional(),
      start_time: z.coerce.number().int().optional(),
      end_time: z.coerce.number().int().optional(),
      is_active: z.boolean().optional(),
      applicable_product_ids: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const parsed = promotionsToolSchema.parse(args);
        const result = await handlePromotionsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_vouchers",
    "Manage voucher codes in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      voucher_id: z.string().optional().describe("Voucher ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      code: z.string().optional().describe("Unique voucher code (required for create)"),
      name: z.string().optional(),
      discount_type: z.enum(["percent", "amount"]).optional(),
      discount_value: z.coerce.number().optional(),
      minimum_order_value: z.coerce.number().optional(),
      max_usage: z.coerce.number().int().optional(),
      start_time: z.coerce.number().int().optional(),
      end_time: z.coerce.number().int().optional(),
      is_active: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = vouchersToolSchema.parse(args);
        const result = await handleVouchersTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  // ── Phase 4: CRM + Multi-Channel ──────────────────────────────────────────

  server.tool(
    "manage_crm_contacts",
    "Manage CRM contacts in Pancake POS. Actions: list, get, create, update, delete. CRM pipeline: contacts → deals → activities.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      contact_id: z.string().optional().describe("CRM contact ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Contact name (required for create)"),
      phone: z.string().optional(),
      email: z.string().optional(),
      company: z.string().optional(),
      address: z.string().optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const parsed = crmContactsToolSchema.parse(args);
        const result = await handleCrmContactsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_crm_deals",
    "Manage CRM deals (sales pipeline opportunities) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      deal_id: z.string().optional().describe("CRM deal ID (required for get/update/delete)"),
      contact_id: z.string().optional().describe("Linked CRM contact ID"),
      search: z.string().optional(),
      stage: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Deal name (required for create)"),
      amount: z.coerce.number().optional(),
      expected_close_date: z.string().optional(),
      note: z.string().optional(),
    },
    async (args) => {
      try {
        const parsed = crmDealsToolSchema.parse(args);
        const result = await handleCrmDealsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_crm_activities",
    "Manage CRM activities (calls, meetings, notes, emails, tasks) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      activity_id: z.string().optional().describe("CRM activity ID (required for get/update/delete)"),
      contact_id: z.string().optional().describe("Filter by CRM contact ID"),
      deal_id: z.string().optional().describe("Filter by CRM deal ID"),
      activity_type: z.enum(["call", "meeting", "note", "email", "task"]).optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      title: z.string().optional().describe("Activity title (required for create)"),
      description: z.string().optional(),
      scheduled_at: z.string().optional(),
      duration_minutes: z.coerce.number().int().optional(),
      is_completed: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = crmActivitiesToolSchema.parse(args);
        const result = await handleCrmActivitiesTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_ecommerce",
    "Manage ecommerce channel integrations (Shopee, Lazada, TikTok) in Pancake POS. Actions: sync (trigger channel sync), list_products.",
    {
      action: z.enum(["sync", "list_products"]).describe("Action to perform"),
      channel: z.enum(["shopee", "lazada", "tiktok"]).optional().describe("Ecommerce channel (required for sync)"),
      shop_channel_id: z.string().optional(),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = ecommerceToolSchema.parse(args);
        const result = await handleEcommerceTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_livestream",
    "Manage live selling sessions (livestreams) in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      livestream_id: z.string().optional().describe("Livestream ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Livestream title (required for create)"),
      scheduled_at: z.string().optional(),
      description: z.string().optional(),
      product_ids: z.array(z.string()).optional(),
      status: z.coerce.number().int().optional(),
    },
    async (args) => {
      try {
        const parsed = livestreamToolSchema.parse(args);
        const result = await handleLivestreamTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  // ── Phase 5: Operations + Polish ──────────────────────────────────────────

  server.tool(
    "manage_employees",
    "Manage employees/staff in Pancake POS. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      employee_id: z.string().optional().describe("Employee ID (required for get/update/delete)"),
      search: z.string().optional(),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      name: z.string().optional().describe("Employee full name (required for create)"),
      phone_number: z.string().optional(),
      email: z.string().optional(),
      role: z.string().optional(),
      warehouse_ids: z.array(z.string()).optional(),
      is_active: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = employeesToolSchema.parse(args);
        const result = await handleEmployeesTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "manage_webhooks",
    "Manage webhooks for Pancake POS event notifications. Actions: list, get, create, update, delete.",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      webhook_id: z.string().optional().describe("Webhook ID (required for get/update/delete)"),
      page_number: z.coerce.number().int().optional(),
      page_size: z.coerce.number().int().optional(),
      url: z.string().optional().describe("Webhook URL (required for create)"),
      events: z.array(z.string()).optional().describe("Event types to subscribe to"),
      headers: z.record(z.string(), z.string()).optional(),
      is_active: z.boolean().optional(),
    },
    async (args) => {
      try {
        const parsed = webhooksToolSchema.parse(args);
        const result = await handleWebhooksTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "get_statistics",
    "Get statistics reports from Pancake POS. Action: get with type=inventory|sales|orders. Supports date range and grouping.",
    {
      action: z.enum(["get"]).describe("Action to perform"),
      type: z.enum(["inventory", "sales", "orders"]).describe("Statistics type"),
      startDateTime: z.coerce.number().int().optional().describe("Start date unix timestamp"),
      endDateTime: z.coerce.number().int().optional().describe("End date unix timestamp"),
      group_by: z.string().optional().describe("Group by: day, week, month, product, category"),
      warehouse_id: z.string().optional(),
    },
    async (args) => {
      try {
        const parsed = statisticsToolSchema.parse(args);
        const result = await handleStatisticsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "get_shop_info",
    "Get or update Pancake POS shop information. Actions: get (retrieve shop profile), update (update shop details).",
    {
      action: z.enum(["get", "update"]).describe("Action to perform"),
      name: z.string().optional().describe("Shop display name"),
      phone_number: z.string().optional(),
      email: z.string().optional(),
      address: z.string().optional(),
      province_id: z.string().optional(),
      district_id: z.string().optional(),
      commune_id: z.string().optional(),
      website: z.string().optional(),
      logo_url: z.string().optional(),
    },
    async (args) => {
      try {
        const parsed = shopInfoToolSchema.parse(args);
        const result = await handleShopInfoTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "analytics",
    `Purpose-built analytics over Pancake POS orders. Single call, no pagination, no client-side aggregation. USE THIS FOR: top-N orders, revenue/total queries.

Actions:
- top_orders: Find top N orders by metric (total_price | total_quantity). Optional date range + status filter. Thin response with id/total_price/inserted_at/customer name.
- revenue_summary: Revenue + count + status breakdown for a date range using server-side Elasticsearch aggregations. Returns revenue_cod (cash-on-delivery), prepaid, shipping_fee, partner_fee, total_orders, status_breakdown. Currency: VND.

Examples:
- Top 5 orders by total this year: analytics({ action: "top_orders", metric: "total_price", limit: 5, startDateTime, endDateTime })
- Largest order ever: analytics({ action: "top_orders", metric: "total_price", limit: 1 })
- Revenue this month: analytics({ action: "revenue_summary", startDateTime, endDateTime })
- Delivered-only revenue: analytics({ action: "revenue_summary", startDateTime, endDateTime, filter_status: [3] })`,
    {
      action: z.enum(["top_orders", "revenue_summary"]).describe("Analytics action"),
      metric: z
        .enum(["total_price", "total_quantity"])
        .optional()
        .describe("top_orders only: ranking metric (default total_price)"),
      limit: z.coerce.number().int().min(1).max(100).optional().describe("top_orders only: N (default 10, max 100)"),
      startDateTime: z.coerce.number().int().optional().describe("Start unix timestamp (required for revenue_summary)"),
      endDateTime: z.coerce.number().int().optional().describe("End unix timestamp (required for revenue_summary)"),
      filter_status: z
        .array(z.coerce.number().int())
        .optional()
        .describe("Filter by status codes, e.g. [3] for delivered"),
      fields: z
        .array(z.string())
        .optional()
        .describe("top_orders only: override returned fields"),
    },
    async (args) => {
      try {
        const parsed = analyticsToolSchema.parse(args);
        const result = await handleAnalyticsTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.tool(
    "lookup_address",
    "Lookup Vietnamese administrative locations in Pancake POS via /geo/* endpoints. Polymorphic on ID format: OLD (e.g. '109' = Hưng Yên) returns 3-tier (province→district→commune); NEW post-2025-07-01 (e.g. '84_VN105') returns 2-tier (no district level — reform abolished districts). Use OLD format if you need district_id for legacy shipping_address; use NEW format for current admin structure. Provinces response includes both `id` (OLD) and `new_id` (NEW) for cross-mapping.",
    {
      action: z.enum(["provinces", "districts", "communes"]).describe("provinces: list all (returns both OLD id and new_id). districts: OLD-only, requires OLD province_id. communes: requires province_id (OLD or NEW) OR district_id (OLD); accepts either."),
      province_id: z.string().optional().describe("Province ID. OLD format e.g. '109', or NEW format e.g. '84_VN105'. Required for districts (OLD only) and recommended for communes."),
      district_id: z.string().optional().describe("District ID, OLD format only e.g. '10909' (NEW format has no districts). Optional for communes — narrows OLD results to one district."),
    },
    async (args) => {
      try {
        const parsed = addressLookupToolSchema.parse(args);
        const result = await handleAddressLookupTool(parsed, client);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
