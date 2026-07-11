import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import {
  PaginationParams,
  DateRangeParams,
  VietnamAddressSchema,
  type VietnamAddress,
} from "../shared/schemas.js";
import { ORDER_SORT_VALUES, ORDER_SORT_DESCRIPTION } from "../shared/sort-options.js";
import { project } from "../shared/response-projection.js";
import { ORDER_COMPACT_MASK } from "../shared/compact-masks.js";
import { PancakeApiError } from "../shared/error-handler.js";

const VerbositySchema = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    "Response detail level. 'compact' (default) returns essential fields only (~85% smaller). 'full' returns raw Pancake response — INCLUDES editor_id/creator_id which equal the api_key UUID; avoid in logged contexts.",
  );

const CreateShippingAddressSchema = VietnamAddressSchema.extend({
  full_name: z.string(),
  phone_number: z.string(),
  address: z.string(),
});

const LOCATION_FIELDS = [
  "province_id",
  "district_id",
  "commune_id",
  "new_province_id",
  "new_commune_id",
] as const;

// Fields verified (or strongly suspected) to silent-drop under api_key auth.
// After PUT we GET the order to detect silent-drop and warn the caller.
const FRAGILE_FIELDS = [
  "shipping_fee",
  "partner_fee",
  "is_free_shipping",
  "total_discount",
  "surcharge",
] as const;
type FragileField = (typeof FRAGILE_FIELDS)[number];

const WORKAROUND_HINTS: Record<FragileField, string> = {
  shipping_fee: "Try sending with is_free_shipping=false on shops that require it.",
  partner_fee: "Try sending shipping_fee together with partner_fee.",
  is_free_shipping: "Some shops require an explicit shipping_fee value alongside this flag.",
  total_discount:
    "Order-level discount may be recomputed from items[].discount_each_product or activated_promotion_advances. Try per-item discount instead.",
  surcharge: "Often dropped under api_key auth. Verify on a test shop.",
};

const OrderItemSchema = z.object({
  quantity: z.coerce.number().int().min(1),
  variation_id: z.string(),
  product_id: z.string(),
  discount_each_product: z.coerce.number().optional(),
  is_bonus_product: z.boolean().optional(),
  note: z.string().optional(),
});

// Enforce a complete location set (OLD: province+district+commune, NEW: province+commune)
// when caller intends to set location. Pure contact updates (phone_number/full_name only)
// bypass. Bare province_id without commune is rejected — shipping partners reject orders
// missing commune-level resolution, so we fail fast at MCP layer rather than create
// a broken order on Pancake.
function assertAddressHasLocation(addr: VietnamAddress, mode: "create" | "update"): void {
  const hasOldFull = !!(addr.province_id && addr.district_id && addr.commune_id);
  const hasNewFull = !!(addr.new_province_id && addr.new_commune_id);
  const hasOld = hasOldFull;
  const hasNew = hasNewFull;
  const sentAnyLocation = LOCATION_FIELDS.some((k) => addr[k] !== undefined);

  // Reject partial OLD/NEW sets early with a precise message — guides the LLM to
  // call lookup_address rather than guess missing IDs.
  if (mode === "create") {
    if (addr.province_id && !hasOldFull) {
      throw new Error(
        `Create order: shipping_address has province_id="${addr.province_id}" ` +
          `but is missing district_id and/or commune_id. OLD format requires all three. ` +
          `Resolve via lookup_address(action="districts", province_id=...) then ` +
          `lookup_address(action="communes", province_id=..., district_id=...). ` +
          `Do NOT guess IDs.`,
      );
    }
    if (addr.new_province_id && !hasNewFull) {
      throw new Error(
        `Create order: shipping_address has new_province_id="${addr.new_province_id}" ` +
          `but is missing new_commune_id. NEW format requires both. ` +
          `Resolve via lookup_address(action="communes", province_id=<NEW id>).`,
      );
    }
  }

  if (mode === "create") {
    if (!hasOld && !hasNew) {
      throw new Error(
        "Create order: shipping_address requires province_id (OLD format) or new_province_id (NEW format post-2025-07-01).",
      );
    }
    return;
  }

  if (sentAnyLocation && !hasOld && !hasNew) {
    throw new Error(
      "Update shipping_address: when sending location fields, at least province_id (OLD) or new_province_id (NEW) is required. Pure contact updates (phone_number, full_name) are OK.",
    );
  }
}

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by phone, customer name, note, or order code"),
  filter_status: z.array(z.coerce.number().int()).optional().describe("Filter by status codes (e.g. [0,1])"),
  include_removed: z.literal(1).optional().describe("Set to 1 to include deleted orders"),
  updateStatus: z.string().optional().describe("Filter by time type: inserted_at, updated_at, paid_at, etc."),
  option_sort: z.enum(ORDER_SORT_VALUES).optional().describe(ORDER_SORT_DESCRIPTION),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      'Project specific fields (Elasticsearch _source). Slashes ~95% payload. Example: ["id","total_price","bill_full_name","inserted_at"].',
    ),
  partner_id: z.array(z.coerce.number().int()).optional().describe("Filter by shipping partner IDs"),
  customer_id: z.string().optional().describe("Filter by customer UUID"),
  order_sources: z.array(z.array(z.string())).optional().describe("Filter by source [[source_code, account_id]]"),
  verbosity: VerbositySchema,
  ...PaginationParams.shape,
  ...DateRangeParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  order_id: z.coerce.number().int().describe("Order ID"),
  verbosity: VerbositySchema,
});

const CreateAction = z.object({
  action: z.literal("create"),
  bill_full_name: z.string().describe("Buyer full name"),
  bill_phone_number: z.string().describe("Buyer phone number"),
  bill_email: z.string().optional().describe("Buyer email"),
  is_free_shipping: z.boolean().optional(),
  received_at_shop: z.boolean().optional().describe("Customer picks up at shop"),
  items: z.array(OrderItemSchema).min(1).describe("Order items"),
  note: z.string().optional().describe("Order note"),
  note_print: z.string().optional().describe("Note printed on order"),
  warehouse_id: z.string().describe("Warehouse UUID for order fulfillment"),
  shipping_address: CreateShippingAddressSchema.describe(
    "Shipping address. Use OLD format (province_id+district_id+commune_id) for pre-2025-07-01 IDs or NEW format (new_province_id+new_commune_id) post-reform. At least one province anchor required.",
  ),
  shipping_fee: z.coerce.number().optional(),
  total_discount: z.coerce.number().optional(),
  surcharge: z.coerce.number().optional(),
  custom_id: z.string().optional().describe("Custom order ID"),
  customer_pay_fee: z.boolean().optional(),
  tags: z.array(z.coerce.number().int()).optional(),
  verbosity: VerbositySchema,
});

const UpdateAction = z.object({
  action: z.literal("update"),
  order_id: z.coerce.number().int().describe("Order ID to update"),
  status: z.coerce.number().int().optional().describe("New order status"),
  shipping_address: VietnamAddressSchema.optional().describe(
    "Update shipping address. Send only fields to change. Mix OLD/NEW format as needed. Pure contact-only updates (phone_number, full_name) are allowed.",
  ),
  note: z.string().optional(),
  tags: z.array(z.coerce.number().int()).optional(),
  shipping_fee: z.coerce.number().optional().describe(
    "Shipping fee. On some shops the backend silently drops this when sent alone — Phase 5 verify-after-update will surface a warning. Try sending with is_free_shipping together if dropped.",
  ),
  partner_fee: z.coerce.number().optional().describe(
    "Partner shipping fee. Often auto-syncs with shipping_fee on backend.",
  ),
  is_free_shipping: z.boolean().optional().describe(
    "Free shipping flag. Some shops require sending alongside shipping_fee value.",
  ),
  total_discount: z.coerce.number().optional().describe(
    "Order-level total discount. Pancake may recompute from per-item discount or active promotions; verify-after-update will warn on silent-drop.",
  ),
  surcharge: z.coerce.number().optional(),
  note_print: z.string().optional().describe("Note printed on order receipt"),
  received_at_shop: z.boolean().optional().describe("Customer pickup at shop"),
  custom_id: z.string().optional(),
  bill_email: z.string().optional(),
  items: z.array(OrderItemSchema).optional().describe(
    "Replace order items. Pancake only allows item changes when order status === 0 (Mới). " +
      "Pre-check enforces this and fails fast.",
  ),
  // NOTE: customer_pay_fee intentionally excluded — Pancake api_key auth
  // silently drops this field (verified 2026-04-28 on shop 123456789).
  verbosity: VerbositySchema,
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  order_id: z
    .union([z.coerce.number().int(), z.string().min(1)])
    .describe(
      "Order identifier. Defaults to display_id (the small per-shop number, e.g. 521 or 'A483'). " +
        "Set id_kind='id' to pass the internal Pancake id directly.",
    ),
  id_kind: z
    .enum(["display_id", "id"])
    .default("display_id")
    .describe(
      "Which id space order_id is in. 'display_id' (default) — small per-shop sequential code; resolver finds internal id. 'id' — large internal Pancake id; skip resolver.",
    ),
});

// Single-update payload for batch_update. Excludes items[] (would require per-order
// status===0 GET pre-check, defeating batch performance) and shipping_address
// (rarely needed in bulk). Covers the high-volume use case: mark payment notes,
// flip statuses, retag.
const BatchUpdateItemSchema = z.object({
  order_id: z.coerce.number().int(),
  note: z.string().optional(),
  status: z.coerce.number().int().optional(),
  tags: z.array(z.coerce.number().int()).optional(),
  note_print: z.string().optional(),
});

const BatchUpdateAction = z.object({
  action: z.literal("batch_update"),
  updates: z
    .array(BatchUpdateItemSchema)
    .min(1)
    .max(50)
    .describe(
      "Per-order update payloads (max 50). Each item must have order_id plus at least one updatable field (note/status/tags/note_print). Use this instead of N separate update calls when processing payment confirmations or status flips for many orders.",
    ),
});

const PrintAction = z.object({
  action: z.literal("print"),
  order_id: z.coerce.number().int().describe("Order ID to print"),
  template: z.enum(["default", "a5", "label"]).optional().describe("Print template"),
});

const ShipAction = z.object({
  action: z.literal("ship"),
  order_id: z.coerce.number().int().describe("Order ID to ship"),
  partner_id: z.coerce.number().int().describe("Shipping partner ID"),
  customer_pay_fee: z.boolean().optional(),
  note_print: z.string().optional(),
  service_type_id: z.coerce.number().int().optional().describe("Service type (2=standard)"),
  pick_shift: z.array(z.coerce.number().int()).optional(),
  required_note: z.string().optional().describe("Delivery requirement note"),
});

const CallLaterAction = z.object({
  action: z.literal("call_later"),
  order_ids: z.array(z.string()).min(1).describe("Order IDs to schedule callback"),
  needs_call_at: z.string().describe("ISO datetime for callback schedule"),
  phone_number: z.string().describe("Phone number to call"),
  notice_created: z.string().describe("Callback reminder note"),
  need_notify_users: z.array(z.string()).describe("User UUIDs to notify"),
});

export const ordersToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  BatchUpdateAction,
  DeleteAction,
  PrintAction,
  ShipAction,
  CallLaterAction,
]);

export type OrdersToolInput = z.infer<typeof ordersToolSchema>;

// Phase 0 probe (2026-05-09 against real sandbox shop): Pancake list endpoint
// IGNORES filter_display_id / filter_system_id / filter_id (returns full status=0
// page regardless). The user-facing per-shop number is exposed as `system_id` in
// the response (some shops also surface `display_id`; `id` mirrors `system_id`
// in shops with small order counts). Resolver post-filters strict-equal against
// `system_id ?? display_id ?? id` to handle shop variance.
//
// Two-stage lookup:
//   1. Fast path: `search=<n>` + filter_status:[0] (1 request, narrow result).
//      Pancake `search` is fuzzy multi-field — may not index system_id on every
//      shop. If it does, we get ≤200 candidates and post-filter to exact match.
//   2. Fallback: bounded page-scan over filter_status:[0] (up to RESOLVER_MAX_PAGES
//      pages × 200 rows). Triggers when stage 1 returns 0 exact matches. Catches
//      shops where `search` doesn't reach system_id.
const RESOLVER_MAX_PAGES = 5; // 5 × 200 = 1000 status=0 orders max

async function resolveOrderDisplayId(
  client: PancakeHttpClient,
  displayId: number | string,
): Promise<number> {
  if (typeof displayId === "number" && displayId > 1_000_000) {
    throw new PancakeApiError(
      "LIKELY_INTERNAL_ID",
      `Order id ${displayId} looks like an internal Pancake id, not a display_id. ` +
        `Pass id_kind:"id" if intentional.`,
      400,
    );
  }
  type Row = { id: number; system_id?: number | string; display_id?: number | string };
  const target = String(displayId);
  const matchKey = (r: Row): string =>
    String(r.system_id ?? r.display_id ?? r.id);

  // Stage 1: search-narrowed
  const search = await client.getList<Row>("orders", {
    search: target,
    filter_status: [0],
    page_size: 200,
  });
  let matched = (search.data ?? []).filter((r) => matchKey(r) === target);

  // Stage 2: fallback page-scan (only when stage 1 found nothing)
  let scannedAll = true;
  if (matched.length === 0) {
    const collected: Row[] = [];
    for (let page = 1; page <= RESOLVER_MAX_PAGES; page++) {
      const res = await client.getList<Row>("orders", {
        filter_status: [0],
        page_number: page,
        page_size: 200,
      });
      const rows = res.data ?? [];
      for (const r of rows) {
        if (matchKey(r) === target) collected.push(r);
      }
      if (rows.length < 200) break;
      if (page === RESOLVER_MAX_PAGES) scannedAll = false;
    }
    matched = collected;
  }

  if (matched.length === 0) {
    throw new PancakeApiError(
      "NOT_FOUND_DISPLAY_ID",
      `Order with display_id ${displayId} not found among status=0 orders` +
        (scannedAll ? "" : ` (scanned ${RESOLVER_MAX_PAGES * 200} most recent; older orders not searched)`) +
        `. If status >= 1 use action="update" to transition; ` +
        `if you have the internal id retry with id_kind:"id".`,
      404,
    );
  }
  if (matched.length > 1) {
    const ids = matched.map((r) => r.id).join(", ");
    throw new PancakeApiError(
      "AMBIGUOUS_DISPLAY_ID",
      `${matched.length} orders match display_id ${displayId} (ids: ${ids}). ` +
        `Use id_kind:"id" with the internal id.`,
      409,
    );
  }
  return Number(matched[0]!.id);
}

export async function handleOrdersTool(args: OrdersToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, verbosity, ...params } = args;
      const result = await client.getList("orders", params);
      const formatted = formatPaginatedResult(result);
      if (Array.isArray(formatted.data)) {
        formatted.data = formatted.data.map((o) => project(o, ORDER_COMPACT_MASK, verbosity));
      }
      return formatted;
    }
    case "get": {
      const result = await client.get(`orders/${args.order_id}`);
      return project(result.data, ORDER_COMPACT_MASK, args.verbosity);
    }
    case "create": {
      const { action, verbosity, ...body } = args;
      assertAddressHasLocation(body.shipping_address, "create");
      const result = await client.post("orders", body);
      return project(result.data, ORDER_COMPACT_MASK, verbosity);
    }
    case "update": {
      const { action, order_id, verbosity, ...body } = args;
      if (body.shipping_address) {
        assertAddressHasLocation(body.shipping_address, "update");
      }
      if (body.items !== undefined) {
        const current = await client.get<{ status?: number }>(`orders/${order_id}`);
        const status = current.data.status ?? 0;
        if (status >= 1) {
          throw new Error(
            `Cannot change items: order ${order_id} is at status ${status}. ` +
              `Pancake only allows item changes when status === 0 (Mới).`,
          );
        }
      }
      const putResult = await client.put<Record<string, unknown>>(`orders/${order_id}`, body);

      // sentFragile detect from INPUT body (not response) — projection-safe
      const sentFragile = FRAGILE_FIELDS.filter(
        (k) => (body as Record<string, unknown>)[k] !== undefined,
      );
      if (sentFragile.length === 0) {
        return project(putResult.data, ORDER_COMPACT_MASK, verbosity);
      }

      // verify-after-update GET stays RAW — must compare sent vs got before projection
      const warnings: string[] = [];
      try {
        const verify = await client.get<Record<string, unknown>>(`orders/${order_id}`);
        for (const field of sentFragile) {
          const sent = (body as Record<string, unknown>)[field];
          const got = verify.data[field];
          if (sent !== got) {
            warnings.push(
              `Field '${field}' silently dropped: sent ${JSON.stringify(sent)}, ` +
                `current ${JSON.stringify(got)}. ${WORKAROUND_HINTS[field]}`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`verify-after-update GET failed: ${msg}`);
      }

      // Project ONLY at final return; warnings already detected against raw verify.data
      const projected = project(putResult.data, ORDER_COMPACT_MASK, verbosity);
      return warnings.length > 0
        ? { ...(projected as Record<string, unknown>), warnings }
        : projected;
    }
    case "batch_update": {
      const results = await Promise.allSettled(
        args.updates.map(({ order_id, ...body }) => {
          const hasField = Object.values(body).some((v) => v !== undefined);
          if (!hasField) {
            return Promise.reject(
              new Error("each batch_update item needs at least one updatable field"),
            );
          }
          return client
            .put<Record<string, unknown>>(`orders/${order_id}`, body)
            .then((r) => ({ order_id, ok: true as const, data: r.data }));
        }),
      );
      const items = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        const update = args.updates[i];
        return {
          order_id: update?.order_id ?? -1,
          ok: false as const,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        };
      });
      const succeeded = items.filter((i) => i.ok).length;
      return {
        total: args.updates.length,
        succeeded,
        failed: args.updates.length - succeeded,
        results: items,
        note: "verify-after-update skipped in batch mode for performance — call get on suspect order_ids if fragile fields (shipping_fee, total_discount, surcharge) were sent",
      };
    }
    case "delete": {
      const internalId =
        args.id_kind === "display_id"
          ? await resolveOrderDisplayId(client, args.order_id)
          : Number(args.order_id);

      try {
        const cur = await client.get<{ status?: number }>(`orders/${internalId}`);
        if (cur.data.status === undefined) {
          throw new PancakeApiError(
            "STATUS_UNKNOWN",
            `Cannot verify status of order ${internalId}; refusing to delete.`,
            500,
          );
        }
        if (cur.data.status !== 0) {
          throw new PancakeApiError(
            "NOT_DRAFT",
            `Order ${internalId} is at status ${cur.data.status}; ` +
              `only status=0 (Mới) orders are deletable. ` +
              `Use action="update" with status=... to transition.`,
            409,
          );
        }
      } catch (err) {
        if (
          err instanceof PancakeApiError &&
          err.httpStatus === 404 &&
          err.code === "NOT_FOUND"
        ) {
          throw new PancakeApiError(
            "ORDER_NOT_FOUND",
            `Order ${internalId} not found upstream during status pre-check. ` +
              `It may have been removed or the id is invalid.`,
            404,
          );
        }
        throw err;
      }

      try {
        await client.delete(`orders/${internalId}`);
      } catch (err) {
        if (err instanceof PancakeApiError && err.httpStatus === 404) {
          throw new PancakeApiError(
            "ORDER_GONE",
            `Order ${internalId} status=0 confirmed but DELETE returned 404; ` +
              `likely raced (concurrent transition) or removed between pre-check and delete.`,
            404,
          );
        }
        throw err;
      }

      return { success: true, message: `Order ${args.order_id} deleted` };
    }
    case "print": {
      const params: Record<string, unknown> = {};
      if (args.template) params.template = args.template;
      const result = await client.get(`orders/${args.order_id}/print`, params);
      return result.data;
    }
    case "ship": {
      const { action, order_id, ...body } = args;
      const result = await client.post(`orders/${order_id}/send-to-partner`, body);
      return result.data;
    }
    case "call_later": {
      const { action, ...rest } = args;
      const result = await client.post("order_call_laters", {
        order_call_later: { status: 0, ...rest },
      });
      return result.data;
    }
  }
}
