import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const StocktakingItem = z.object({
  variation_id: z.string().describe("Product variation UUID"),
  actual_quantity: z.coerce.number().int().min(0).describe("Physically counted quantity"),
});

const ListAction = z.object({
  action: z.literal("list"),
  warehouse_id: z.string().optional().describe("Filter by warehouse UUID"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  stocktakings_id: z.string().describe("Stocktaking ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  warehouse_id: z.string().describe("Warehouse UUID to count"),
  items: z.array(StocktakingItem).min(1).describe("Items with actual counted quantities"),
  note: z.string().optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  stocktakings_id: z.string().describe("Stocktaking ID to update"),
  status: z.coerce.number().int().optional().describe("Stocktaking status"),
  note: z.string().optional(),
  items: z.array(StocktakingItem).optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  stocktakings_id: z.string().describe("Stocktaking ID to delete"),
});

export const stocktakingToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type StocktakingToolInput = z.infer<typeof stocktakingToolSchema>;

export async function handleStocktakingTool(args: StocktakingToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("stocktakings", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`stocktakings/${args.stocktakings_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("stocktakings", body);
      return result.data;
    }
    case "update": {
      const { action, stocktakings_id, ...body } = args;
      const result = await client.put(`stocktakings/${stocktakings_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`stocktakings/${args.stocktakings_id}`);
      return { success: true, message: `Stocktaking ${args.stocktakings_id} deleted` };
    }
  }
}
