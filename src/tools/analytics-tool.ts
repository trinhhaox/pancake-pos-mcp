import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";

// Fields verified to exist on Pancake order list responses. `items_length` was
// removed — not a documented field; would have been silently dropped by ES
// _source projection, leading LLMs to hallucinate counts.
const DEFAULT_TOP_ORDER_FIELDS = [
  "id",
  "total_price",
  "inserted_at",
  "bill_full_name",
];

const METRIC_TO_SORT = {
  total_price: "order_valuation_desc",
  total_quantity: "product_quantity_desc",
} as const;

const TopOrdersAction = z.object({
  action: z.literal("top_orders"),
  metric: z
    .enum(["total_price", "total_quantity"])
    .default("total_price")
    .describe("Ranking metric: total_price (default, ranks by order_valuation) or total_quantity (ranks by item count)"),
  limit: z.coerce.number().int().min(1).max(100).default(10).describe("Number of top orders (default 10)"),
  startDateTime: z.coerce.number().int().optional().describe("Start unix timestamp"),
  endDateTime: z.coerce.number().int().optional().describe("End unix timestamp"),
  filter_status: z
    .array(z.coerce.number().int())
    .optional()
    .describe("Filter by status codes, e.g. [3] for delivered only"),
  fields: z
    .array(z.string())
    .optional()
    .describe(
      `Override returned fields. Default: ${DEFAULT_TOP_ORDER_FIELDS.join(", ")}.`,
    ),
});

const RevenueSummaryAction = z.object({
  action: z.literal("revenue_summary"),
  startDateTime: z.coerce.number().int().describe("Start unix timestamp (required)"),
  endDateTime: z.coerce.number().int().describe("End unix timestamp (required)"),
  filter_status: z
    .array(z.coerce.number().int())
    .optional()
    .describe("Filter by status codes (e.g. [3] for delivered-only revenue)"),
});

export const analyticsToolSchema = z.discriminatedUnion("action", [
  TopOrdersAction,
  RevenueSummaryAction,
]);

export type AnalyticsToolInput = z.infer<typeof analyticsToolSchema>;

interface OrderListItem {
  id: number;
  total_price?: number;
  inserted_at?: string;
  bill_full_name?: string;
  [k: string]: unknown;
}

export async function handleAnalyticsTool(
  args: AnalyticsToolInput,
  client: Pick<PancakeHttpClient, "getList">,
) {
  switch (args.action) {
    case "top_orders": {
      const result = await client.getList<OrderListItem>("orders", {
        option_sort: METRIC_TO_SORT[args.metric],
        page_number: 1,
        page_size: args.limit,
        fields: args.fields ?? DEFAULT_TOP_ORDER_FIELDS,
        startDateTime: args.startDateTime,
        endDateTime: args.endDateTime,
        filter_status: args.filter_status,
      });
      return formatPaginatedResult(result);
    }
    case "revenue_summary": {
      const result = await client.getList<OrderListItem>("orders", {
        page_number: 1,
        page_size: 1,
        fields: ["id"],
        startDateTime: args.startDateTime,
        endDateTime: args.endDateTime,
        filter_status: args.filter_status,
      });
      const aggs = result.aggs;
      // Reject NaN / non-finite / non-numeric so callers don't silently see 0
      // when a malformed value slips through the unchecked Pancake response.
      const numeric = (key: string): number | null => {
        const v = aggs?.[key];
        if (!v || !("value" in v)) return null;
        return typeof v.value === "number" && Number.isFinite(v.value) ? v.value : null;
      };
      const buckets = (() => {
        const v = aggs?.status;
        return v && "buckets" in v ? (v.buckets ?? []) : [];
      })();

      const cod = numeric("cod");
      const prepaid = numeric("prepaid");
      const shippingFee = numeric("shipping_fee");
      const partnerFee = numeric("partner_fee");

      const warnings: string[] = [];
      if (!aggs) warnings.push("aggs missing from API response — revenue/breakdown unavailable");
      else if (cod === null && prepaid === null) warnings.push("aggs.cod and aggs.prepaid both missing — revenue likely unavailable");

      return {
        period: { from: args.startDateTime, to: args.endDateTime },
        total_orders: result.total_entries,
        revenue_cod: cod ?? 0,
        prepaid: prepaid ?? 0,
        shipping_fee: shippingFee ?? 0,
        partner_fee: partnerFee ?? 0,
        status_breakdown: buckets,
        currency: "VND",
        aggs_available: !!aggs,
        warnings,
        note: "revenue_cod = aggs.cod sum (cash-on-delivery only). For prepaid/bank-transfer revenue use prepaid field. If warnings non-empty, treat numeric fields as unreliable.",
      };
    }
  }
}
