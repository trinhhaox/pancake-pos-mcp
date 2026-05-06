import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { formatPaginatedResult } from "../shared/pagination-helpers.js";
import { PaginationParams } from "../shared/schemas.js";

const ListAction = z.object({
  action: z.literal("list"),
  search: z.string().optional().describe("Search by product name, custom_id, or barcode"),
  category_ids: z.array(z.coerce.number().int()).optional().describe("Filter by category IDs"),
  tag_ids: z.array(z.coerce.number().int()).optional().describe("Filter by tag IDs"),
  type: z.enum(["product", "combo", "service"]).optional().describe("Product type filter"),
  ...PaginationParams.shape,
});

const GetAction = z.object({
  action: z.literal("get"),
  product_id: z.string().describe("Product UUID"),
});

const CreateAction = z.object({
  action: z.literal("create"),
  name: z.string().describe("Product name"),
  custom_id: z.string().optional().describe("Custom product ID / SKU"),
  category_ids: z.array(z.coerce.number().int()).optional(),
  brand_id: z.coerce.number().int().optional(),
  description: z.string().optional(),
  weight: z.coerce.number().optional().describe("Weight in grams"),
  retail_price: z.coerce.number().optional().describe("Retail price"),
  wholesale_price: z.coerce.number().optional().describe("Wholesale price"),
  last_imported_price: z.coerce.number().optional().describe("Cost price"),
  images: z.array(z.string()).optional().describe("Image URLs"),
  variations: z.array(z.object({
    keyword: z.string().describe("Variation keyword/name"),
    custom_id: z.string().optional(),
    retail_price: z.coerce.number().optional(),
    wholesale_price: z.coerce.number().optional(),
    weight: z.coerce.number().optional(),
    barcode: z.string().optional(),
    fields: z.array(z.object({
      name: z.string(),
      value: z.string(),
    })).optional().describe("Variation attributes like Color, Size"),
  })).optional().describe("Product variations"),
});

const UpdateAction = z.object({
  action: z.literal("update"),
  product_id: z.string().describe("Product UUID to update"),
  name: z.string().optional(),
  custom_id: z.string().optional(),
  category_ids: z.array(z.coerce.number().int()).optional(),
  brand_id: z.coerce.number().int().optional(),
  description: z.string().optional(),
  retail_price: z.coerce.number().optional(),
  images: z.array(z.string()).optional(),
});

const DeleteAction = z.object({
  action: z.literal("delete"),
  product_id: z.string().describe("Product UUID to delete"),
});

const ListVariationsAction = z.object({
  action: z.literal("list_variations"),
  product_id: z.string().describe("Product UUID"),
});

const CreateVariationAction = z.object({
  action: z.literal("create_variation"),
  product_id: z.string().describe("Product UUID to add variation to"),
  keyword: z.string().describe("Variation keyword/name"),
  custom_id: z.string().optional(),
  retail_price: z.coerce.number().optional(),
  wholesale_price: z.coerce.number().optional(),
  weight: z.coerce.number().optional(),
  barcode: z.string().optional(),
  fields: z.array(z.object({
    name: z.string(),
    value: z.string(),
  })).optional(),
});

export const productsToolSchema = z.discriminatedUnion("action", [
  ListAction,
  GetAction,
  CreateAction,
  UpdateAction,
  DeleteAction,
  ListVariationsAction,
  CreateVariationAction,
]);

export type ProductsToolInput = z.infer<typeof productsToolSchema>;

export async function handleProductsTool(args: ProductsToolInput, client: PancakeHttpClient) {
  switch (args.action) {
    case "list": {
      const { action, ...params } = args;
      const result = await client.getList("products", params);
      return formatPaginatedResult(result);
    }
    case "get": {
      const result = await client.get(`products/${args.product_id}`);
      return result.data;
    }
    case "create": {
      const { action, ...body } = args;
      const result = await client.post("products", { product: body });
      return result.data;
    }
    case "update": {
      const { action, product_id, ...body } = args;
      const result = await client.put(`products/${product_id}`, { product: body });
      return result.data;
    }
    case "delete": {
      await client.delete(`products/${args.product_id}`);
      return { success: true, message: `Product ${args.product_id} deleted` };
    }
    case "list_variations": {
      // Pancake POS does not expose /products/{id}/variations as a sub-resource
      // (verified 2026-05-06: returns 404). Variations live embedded in the
      // product GET response, so we fetch the product and project the array.
      const result = await client.get<{ variations?: unknown[] }>(`products/${args.product_id}`);
      return { data: result.data.variations ?? [] };
    }
    case "create_variation": {
      const { action, product_id, ...body } = args;
      const result = await client.post(`products/${product_id}/variations`, { variation: body });
      return result.data;
    }
  }
}
