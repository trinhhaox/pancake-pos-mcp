import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by supplier name or phone"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  supplier_id: z.string().describe("Supplier ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  name: z.string().describe("Supplier name"),
  phone_number: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  supplier_id: z.string().describe("Supplier ID to update"),
  name: z.string().optional(),
  phone_number: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  description: z.string().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  supplier_id: z.string().describe("Supplier ID to delete"),
});

export const suppliersToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type SuppliersToolInput = z.infer<typeof suppliersToolSchema>;

export async function handleSuppliersTool(args: SuppliersToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("supplier", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`supplier/${args.supplier_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("supplier", body);
      return result.data;
    }
    case "update": {
      const { action, supplier_id, ...body } = args;
      const result = await client.put(`supplier/${supplier_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`supplier/${args.supplier_id}`);
      return { success: true, message: `Supplier ${args.supplier_id} deleted` };
    }
  }
}
