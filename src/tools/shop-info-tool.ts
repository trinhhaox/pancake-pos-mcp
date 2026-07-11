import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";

const GetAction = z.object({
  action: z.literal("get"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  name: z.string().optional().describe("Shop display name"),
  phone_number: z.string().optional(),
  address: z.string().optional(),
  province_id: z.string().optional(),
  district_id: z.string().optional(),
  commune_id: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  logo_url: z.string().optional(),
});

export const shopInfoToolSchema = z.discriminatedUnion("action", [
  GetAction,
  UpdateAction,
]);

export type ShopInfoToolInput = z.infer<typeof shopInfoToolSchema>;

export async function handleShopInfoTool(args: ShopInfoToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "get": {
      // Pancake returns the shop at GET /shops/{id} with a root-level
      // `shop` field (NOT wrapped under `data`): { success, shop: {...} }.
      // parseResponse casts the whole JSON to PancakeResponse, so `data` is
      // undefined here — read `shop` directly off the raw response.
      const result = await client.get<Record<string, unknown>>("");
      const raw = result as unknown as Record<string, unknown>;
      return (raw.shop ?? raw.data ?? raw) as Record<string, unknown>;
    }
    case "update": {
      const { action, ...body } = args;
      const result = await client.post("shop/update", body);
      return result.data;
    }
  }
}
