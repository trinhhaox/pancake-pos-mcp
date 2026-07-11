import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by customer name, phone, or email"),
  tags: z.array(z.string()).optional().describe("Filter by customer tags"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  customer_id: z.string().describe("Customer UUID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  name: z.string().describe("Customer full name"),
  phone_numbers: z.array(z.string()).min(1).describe("Phone numbers"),
  emails: z.array(z.string()).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  date_of_birth: z.string().optional().describe("Date of birth (YYYY-MM-DD)"),
  reward_point: z.coerce.number().optional().describe("Reward points to set"),
  tags: z.array(z.string()).optional(),
  is_block: z.boolean().optional().describe("Block this customer"),
  level_id: z.string().optional().describe("Customer level UUID"),
  shop_customer_addresses: z.array(z.object({
    country_code: z.coerce.number().optional(),
    province_id: z.string(),
    district_id: z.string(),
    commune_id: z.string().optional(),
    address: z.string(),
    full_name: z.string(),
    phone_number: z.string(),
  })).optional().describe("Customer addresses"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  customer_id: z.string().describe("Customer UUID to update"),
  name: z.string().optional(),
  phone_numbers: z.array(z.string()).optional(),
  emails: z.array(z.string()).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  date_of_birth: z.string().optional(),
  reward_point: z.coerce.number().optional(),
  tags: z.array(z.string()).optional(),
  is_block: z.boolean().optional(),
  level_id: z.string().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  customer_id: z.string().describe("Customer UUID to delete"),
});

const RewardHistoryAction = z.object({
  action: z.literal("reward_history"),
  customer_id: z.string().describe("Customer UUID"),
});

const AddNoteAction = z.object({
  action: z.literal("add_note"),
  customer_id: z.string().optional().describe("Customer UUID (optional if using conversation_id)"),
  conversation_id: z.string().optional().describe("Conversation ID for CRM note"),
  page_id: z.string().optional().describe("Page ID for CRM note"),
  message: z.string().describe("Note message"),
  order_id: z.coerce.number().int().optional().describe("Related order ID"),
  images: z.array(z.object({
    url: z.string(),
    name: z.string().optional(),
  })).optional().describe("Image attachments"),
});

export const customersToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
  RewardHistoryAction,
  AddNoteAction,
]);

export type CustomersToolInput = z.infer<typeof customersToolSchema>;

export async function handleCustomersTool(args: CustomersToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("customers", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`customers/${args.customer_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("customers", { customer: body });
      return result.data;
    }
    case "update": {
      const { action, customer_id, ...body } = args;
      const result = await client.put(`customers/${customer_id}`, { customer: body });
      return result.data;
    }
    case "delete": {
      await client.delete(`customers/${args.customer_id}`);
      return { success: true, message: `Customer ${args.customer_id} deleted` };
    }
    case "reward_history": {
      const result = await client.get(`customers/${args.customer_id}/reward-point-history`);
      return result.data;
    }
    case "add_note": {
      // Pancake: POST /shops/{id}/customers/{customer_id}/create_note
      const { action, customer_id, ...body } = args;
      if (!customer_id) throw new Error("add_note requires customer_id");
      const result = await client.post(`customers/${customer_id}/create_note`, body);
      return result.data;
    }
  }
}
