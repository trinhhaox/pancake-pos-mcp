import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

// Pancake POS CRM is a DYNAMIC table system. Activities are a user-defined table.
// Endpoints (official OpenAPI spec):
//   GET  /crm/tables                -> list configured tables
//   GET  /crm/{TABLE_NAME}/records   -> list records
//   POST /crm/{TABLE_NAME}/records
//   PUT/DELETE /crm/{TABLE_NAME}/records/{ID}

const TableNameField = z
  .string()
  .describe("CRM table slug/name for activities, e.g. 'activities'. List tables via action='list_tables'.");

const ListTablesAction = z.object({ action: z.literal("list_tables") });

const ListAction = z.object({
  action: z.literal("list"),
  table_name: TableNameField,
  contact_id: z.string().optional().describe("Filter by CRM contact ID"),
  deal_id: z.string().optional().describe("Filter by CRM deal ID"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  table_name: TableNameField,
  activity_id: z.string().describe("CRM activity record ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  table_name: TableNameField,
  activity_type: z.enum(["call", "meeting", "note", "email", "task"]).describe("Type of CRM activity"),
  contact_id: z.string().optional().describe("Linked CRM contact ID"),
  deal_id: z.string().optional().describe("Linked CRM deal ID"),
  title: z.string().describe("Activity title or subject"),
  description: z.string().optional(),
  scheduled_at: z.string().optional().describe("Scheduled time (ISO datetime)"),
  duration_minutes: z.coerce.number().int().optional().describe("Duration in minutes"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  table_name: TableNameField,
  activity_id: z.string().describe("CRM activity record ID to update"),
  title: z.string().optional(),
  description: z.string().optional(),
  scheduled_at: z.string().optional(),
  duration_minutes: z.coerce.number().int().optional(),
  is_completed: z.boolean().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  table_name: TableNameField,
  activity_id: z.string().describe("CRM activity record ID to delete"),
});

export const crmActivitiesToolSchema = z.discriminatedUnion("action", [
  ListTablesAction,
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type CrmActivitiesToolInput = z.infer<typeof crmActivitiesToolSchema>;

export async function handleCrmActivitiesTool(args: CrmActivitiesToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list_tables": {
      const result = await client.getList("crm/tables");
      return formatPaginatedResult(result);
    }
    case "list": {
      const { action, table_name, ...params } = args;
      const result = await client.getList(`crm/${table_name}/records`, params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`crm/${args.table_name}/records/${args.activity_id}`);
      return result.data;
    }
    case "create": {
      const { action, table_name, ...body } = args;
      const result = await client.post(`crm/${table_name}/records`, body);
      return result.data;
    }
    case "update": {
      const { action, table_name, activity_id, ...body } = args;
      const result = await client.put(`crm/${table_name}/records/${activity_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`crm/${args.table_name}/records/${args.activity_id}`);
      return { success: true, message: `CRM activity ${args.activity_id} deleted` };
    }
  }
}
