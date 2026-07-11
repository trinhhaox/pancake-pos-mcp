import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const TransferItem = z.object({
  variation_id: z.string().describe("Product variation UUID"),
  quantity: z.coerce.number().int().min(1),
});

const ListAction = z.object({
  action: z.literal("list"),
  source_warehouse_id: z.string().optional().describe("Filter by source warehouse UUID"),
  destination_warehouse_id: z.string().optional().describe("Filter by destination warehouse UUID"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  transfer_id: z.string().describe("Transfer ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  source_warehouse_id: z.string().describe("Source warehouse UUID"),
  destination_warehouse_id: z.string().describe("Destination warehouse UUID"),
  items: z.array(TransferItem).min(1).describe("Items to transfer"),
  note: z.string().optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  transfer_id: z.string().describe("Transfer ID to update"),
  status: z.coerce.number().int().optional().describe("Transfer status"),
  note: z.string().optional(),
  items: z.array(TransferItem).optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  transfer_id: z.string().describe("Transfer ID to delete"),
});

export const transfersToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type TransfersToolInput = z.infer<typeof transfersToolSchema>;

export async function handleTransfersTool(args: TransfersToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("transfers", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`transfers/${args.transfer_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("transfers", body);
      return result.data;
    }
    case "update": {
      const { action, transfer_id, ...body } = args;
      const result = await client.put(`transfers/${transfer_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`transfers/${args.transfer_id}`);
      return { success: true, message: `Transfer ${args.transfer_id} deleted` };
    }
  }
}
