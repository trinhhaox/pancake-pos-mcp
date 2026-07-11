import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

// Pancake POS CRM is a DYNAMIC table system: contacts/deals/activities are
// user-defined tables. Endpoints per the official OpenAPI spec:
//   GET  /crm/tables                  -> list configured tables
//   GET  /crm/{TABLE_NAME}/records     -> list records in a table
//   GET  /crm/{TABLE_NAME}/records/{ID}
//   POST /crm/{TABLE_NAME}/records
//   PUT  /crm/{TABLE_NAME}/records/{ID}
//   DELETE /crm/{TABLE_NAME}/records/{ID}  (implied)
// The caller must supply `table_name` (the actual CRM table slug).

const TableNameField = z
  .string()
  .describe("CRM table slug/name, e.g. 'contacts'. List available tables via action='list_tables'.");

const ListTablesAction = z.object({
  action: z.literal("list_tables"),
});

const ListAction = z.object({
  action: z.literal("list"),
  table_name: TableNameField,
  search: z.string().optional().describe("Search by name, phone, or email"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  table_name: TableNameField,
  record_id: z.string().describe("CRM record ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  table_name: TableNameField,
  name: z.string().describe("Contact full name"),
  phone: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  address: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  table_name: TableNameField,
  record_id: z.string().describe("CRM record ID to update"),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  address: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  table_name: TableNameField,
  record_id: z.string().describe("CRM record ID to delete"),
});

export const crmContactsToolSchema = z.discriminatedUnion("action", [
  ListTablesAction,
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type CrmContactsToolInput = z.infer<typeof crmContactsToolSchema>;

export async function handleCrmContactsTool(args: CrmContactsToolInput, client: PancakeHttpClient) {
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
      const result = await client.get(`crm/${args.table_name}/records/${args.record_id}`);
      return result.data;
    }
    case "create": {
      const { action, table_name, ...body } = args;
      const result = await client.post(`crm/${table_name}/records`, body);
      return result.data;
    }
    case "update": {
      const { action, table_name, record_id, ...body } = args;
      const result = await client.put(`crm/${table_name}/records/${record_id}`, body);
      return result.data;
    }
    case "delete": {
      await client.delete(`crm/${args.table_name}/records/${args.record_id}`);
      return { success: true, message: `CRM record ${args.record_id} deleted` };
    }
  }
}
