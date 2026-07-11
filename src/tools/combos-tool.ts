import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ComboVariation = z.object({
  variation_id: z.string().describe("Product variation UUID included in combo"),
  quantity: z.coerce.number().int().min(1),
  discount_amount: z.coerce.number().optional().describe("Per-item discount within combo"),
});

const BonusProduct = z.object({
  variation_id: z.string().describe("Bonus product variation UUID"),
  quantity: z.coerce.number().int().min(1),
});

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by combo name"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  combo_id: z.string().describe("Combo ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  name: z.string().describe("Combo name"),
  discount_amount: z.coerce.number().optional().describe("Total combo discount amount"),
  is_free_shipping: z.boolean().optional(),
  variations: z.array(ComboVariation).min(1).describe("Products included in combo"),
  bonus_products: z.array(BonusProduct).optional().describe("Free bonus items with combo"),
  start_time: z.coerce.number().int().optional().describe("Combo start time (unix timestamp)"),
  end_time: z.coerce.number().int().optional().describe("Combo end time (unix timestamp)"),
  order_sources: z.array(z.coerce.number().int()).optional().describe("Applicable order source codes"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  combo_id: z.string().describe("Combo ID to update"),
  name: z.string().optional(),
  discount_amount: z.coerce.number().optional(),
  is_free_shipping: z.boolean().optional(),
  variations: z.array(ComboVariation).optional(),
  bonus_products: z.array(BonusProduct).optional(),
  start_time: z.coerce.number().int().optional(),
  end_time: z.coerce.number().int().optional(),
  order_sources: z.array(z.coerce.number().int()).optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  combo_id: z.string().describe("Combo ID to delete"),
});

export const combosToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type CombosToolInput = z.infer<typeof combosToolSchema>;

export async function handleCombosTool(args: CombosToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("combo_products", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`combo_products/${args.combo_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("combo_products", body);
      return result.data;
    }
    case "update": {
      const { action, combo_id, ...body } = args;
      const result = await client.put(`combo_products/${combo_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`combo_products/${args.combo_id}`);
      return { success: true, message: `Combo ${args.combo_id} deleted` };
    }
  }
}
