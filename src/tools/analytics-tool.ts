import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";

const DEFAULT_TOP_ORDER_FIELDS = [
  "id",
  "total_price",
  "inserted_at",
  "bill_full_name",
  "items_length",
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
  items_length?: number;
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
      const numeric = (key: string): number => {
        const v = aggs?.[key];
        return v && "value" in v && typeof v.value === "number" ? v.value : 0;
      };
      const buckets = (() => {
        const v = aggs?.status;
        return v && "buckets" in v ? (v.buckets ?? []) : [];
      })();
      return {
        period: { from: args.startDateTime, to: args.endDateTime },
        total_orders: result.total_entries,
        revenue_cod: numeric("cod"),
        prepaid: numeric("prepaid"),
        shipping_fee: numeric("shipping_fee"),
        partner_fee: numeric("partner_fee"),
        status_breakdown: buckets,
        currency: "VND",
        note: "revenue_cod = aggs.cod sum (cash-on-delivery only). For prepaid/bank-transfer revenue use prepaid field.",
      };
    }
  }
}
