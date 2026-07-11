import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

// Pancake POS CRM is a DYNAMIC table system. Deals are a user-defined table.
// Endpoints (official OpenAPI spec):
//   GET  /crm/tables                -> list configured tables
//   GET  /crm/{TABLE_NAME}/records   -> list records
//   POST /crm/{TABLE_NAME}/records
//   PUT/DELETE /crm/{TABLE_NAME}/records/{ID}

const TableNameField = z
  .string()
  .describe("CRM table slug/name for deals, e.g. 'deals'. List tables via action='list_tables'.");

const ListTablesAction = z.object({ action: z.literal("list_tables") });

const ListAction = z.object({
  action: z.literal("list"),
  table_name: TableNameField,
  search: z.string().optional().describe("Search by deal name or contact"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  table_name: TableNameField,
  deal_id: z.string().describe("CRM deal record ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  table_name: TableNameField,
  name: z.string().describe("Deal name"),
  contact_id: z.string().optional().describe("Linked CRM contact ID"),
  amount: z.coerce.number().optional().describe("Deal value amount"),
  stage: z.string().optional().describe("Pipeline stage"),
  expected_close_date: z.string().optional().describe("Expected close date (ISO datetime)"),
  note: z.string().optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  table_name: TableNameField,
  deal_id: z.string().describe("CRM deal record ID to update"),
  name: z.string().optional(),
  contact_id: z.string().optional(),
  amount: z.coerce.number().optional(),
  stage: z.string().optional(),
  expected_close_date: z.string().optional(),
  note: z.string().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  table_name: TableNameField,
  deal_id: z.string().describe("CRM deal record ID to delete"),
});

export const crmDealsToolSchema = z.discriminatedUnion("action", [
  ListTablesAction,
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type CrmDealsToolInput = z.infer<typeof crmDealsToolSchema>;

export async function handleCrmDealsTool(args: CrmDealsToolInput, client: PancakeHttpClient) {
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
      const result = await client.get(`crm/${args.table_name}/records/${args.deal_id}`);
      return result.data;
    }
    case "create": {
      const { action, table_name, ...body } = args;
      const result = await client.post(`crm/${table_name}/records`, body);
      return result.data;
    }
    case "update": {
      const { action, table_name, deal_id, ...body } = args;
      const result = await client.put(`crm/${table_name}/records/${deal_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`crm/${args.table_name}/records/${args.deal_id}`);
      return { success: true, message: `CRM deal ${args.deal_id} deleted` };
    }
  }
}
