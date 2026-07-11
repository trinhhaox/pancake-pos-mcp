import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by employee name or phone"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  employee_id: z.string().describe("Employee ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  name: z.string().describe("Employee full name"),
  phone_number: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional().describe("Employee role/position"),
  warehouse_ids: z.array(z.string()).optional().describe("Assigned warehouse UUIDs"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  employee_id: z.string().describe("Employee ID to update"),
  name: z.string().optional(),
  phone_number: z.string().optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  warehouse_ids: z.array(z.string()).optional(),
  is_active: z.boolean().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  employee_id: z.string().describe("Employee ID to delete"),
});

export const employeesToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type EmployeesToolInput = z.infer<typeof employeesToolSchema>;

export async function handleEmployeesTool(args: EmployeesToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("users", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`users/${args.employee_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("users", body);
      return result.data;
    }
    case "update": {
      const { action, employee_id, ...body } = args;
      const result = await client.put(`users/${employee_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`users/${args.employee_id}`);
      return { success: true, message: `Employee ${args.employee_id} deleted` };
    }
  }
}
