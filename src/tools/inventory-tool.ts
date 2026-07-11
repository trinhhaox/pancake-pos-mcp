import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";

const ReportAction = z.object({
  action: z.literal("report"),
  warehouse_ids: z.array(z.string()).optional().describe("Filter by warehouse UUIDs"),
  category_ids: z.array(z.coerce.number().int()).optional().describe("Filter by category IDs"),
  supplier_ids: z.array(z.string()).optional().describe("Filter by supplier UUIDs"),
  brand_ids: z.array(z.coerce.number().int()).optional().describe("Filter by brand IDs"),
  min_quantity: z.coerce.number().optional().describe("Minimum stock quantity"),
  max_quantity: z.coerce.number().optional().describe("Maximum stock quantity"),
  include_hidden: z.boolean().optional().describe("Include hidden products"),
});

export const inventoryToolSchema = z.discriminatedUnion("action", [
  ReportAction,
]);

export type InventoryToolInput = z.infer<typeof inventoryToolSchema>;

export async function handleInventoryTool(args: InventoryToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "report": {
      const { action, ...params } = args;
      const result = await client.get("inventory_analytics/inventory", params);
      return result.data;
    }
  }
}
