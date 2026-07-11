import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { PaginationParams } from "../shared/schemas.js";

// NOTE: The official Pancake POS Open API (api-docs.pancake.vn, v1.0.0, 85
// paths) does NOT expose any webhook management endpoint. Webhooks are
// configured in the Pancake POS dashboard UI, not via this REST API. The
// handlers below therefore do not call the API and return a clear error so
// callers are not misled into thinking the operation succeeded.

const ListAction = z.object({
  action: z.literal("list"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  webhook_id: z.string().describe("Webhook ID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  url: z.string().url().describe("Webhook target URL"),
  events: z.array(z.string()).min(1).describe("Events to subscribe to (e.g. order.created, order.updated)"),
  headers: z.record(z.string(), z.string()).optional().describe("Custom HTTP headers to include in webhook requests"),
  is_active: z.boolean().optional(),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  webhook_id: z.string().describe("Webhook ID to update"),
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  is_active: z.boolean().optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  webhook_id: z.string().describe("Webhook ID to delete"),
});

export const webhooksToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
]);

export type WebhooksToolInput = z.infer<typeof webhooksToolSchema>;

const UNSUPPORTED =
  "Webhook management is not available via the Pancake POS REST API (confirmed against the official OpenAPI spec at api-docs.pancake.vn, v1.0.0). Configure webhooks in the Pancake POS web dashboard instead.";

export async function handleWebhooksTool(_args: WebhooksToolInput, _client: PancakeHttpClient) {
  throw new Error(UNSUPPORTED);
}
