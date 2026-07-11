import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ReturnedItem = z.object({
  variation_id: z.string(),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number().optional(),
});

const ExchangeItem = z.object({
  variation_id: z.string(),
  quantity: z.coerce.number().int().min(1),
  price: z.coerce.number().optional(),
});

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional(),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  return_id: z.string().describe("Return ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  order_id_to_returned: z.coerce.number().int().describe("Original order ID being returned"),
  returned_items: z.array(ReturnedItem).min(1).describe("Items to return"),
  warehouse_id: z.string().describe("Warehouse UUID for returned stock"),
  discount: z.coerce.number().optional().describe("Discount on return"),
  returned_fee: z.coerce.number().optional().describe("Return shipping fee"),
  note: z.string().optional(),
  is_exchange: z.boolean().optional().describe("True if this is an exchange (return + new items)"),
  exchange_items: z.array(ExchangeItem).optional().describe("New items for exchange (required if is_exchange=true)"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  return_id: z.string().describe("Return ID to update"),
  status: z.coerce.number().int().optional(),
  note: z.string().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  return_id: z.string().describe("Return ID to delete"),
});

export const returnsToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type ReturnsToolInput = z.infer<typeof returnsToolSchema>;

export async function handleReturnsTool(args: ReturnsToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("orders_returned", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`orders_returned/${args.return_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("orders_returned", body);
      return result.data;
    }
    case "update": {
      const { action, return_id, ...body } = args;
      const result = await client.put(`orders_returned/${return_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`orders_returned/${args.return_id}`);
      return { success: true, message: `Return ${args.return_id} deleted` };
    }
  }
}
