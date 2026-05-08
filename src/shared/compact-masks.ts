// Per-tool compact mask constants for response-projection.
// Each mask is a Google partial-response string used by `project()` to strip
// unused fields before returning to the MCP client. Keep masks here so future
// audits can trace the field whitelist of every tool in one place.
//
// Populated by phases 2-5 (orders, products, warehouses, address-lookup).

export const ORDER_COMPACT_MASK =
  "id,system_id,display_id,status,status_name," +
  "bill_full_name,bill_phone_number,bill_email," +
  "total_price,total_price_after_sub_discount,total_quantity," +
  // ALL 5 FRAGILE_FIELDS kept (symmetry with FRAGILE_FIELDS in orders-tool.ts).
  // Trivial cost; ensures verify-after-update returns current values to agent
  // without an extra GET round-trip.
  "shipping_fee,partner_fee,total_discount,surcharge," +
  "cod,prepaid," +
  "warehouse_id,warehouse_info(id,name,phone_number)," +
  "shipping_address(full_name,phone_number,address,full_address," +
                   "province_id,district_id,commune_id," +
                   "new_province_id,new_commune_id)," +
  "items(id,product_id,variation_id,quantity,retail_price,note," +
        "discount_each_product,is_bonus_product," +
        "variation_info(id,display_id,fields))," +
  "tags,note,note_print,custom_id," +
  "is_free_shipping,received_at_shop," +
  "inserted_at,updated_at";

export const PRODUCT_COMPACT_MASK =
  "id,name,custom_id,display_id,type," +
  "categories(id,name)," +
  "variations(id,display_id,keyword,retail_price,wholesale_price," +
             "weight,barcode,fields,remain_quantity," +
             "variations_warehouses(warehouse_id,remain_quantity," +
                                   "total_quantity,actual_remain_quantity))";

export const PRODUCT_VARIATIONS_MASK =
  "id,display_id,keyword,retail_price,wholesale_price," +
  "weight,barcode,fields,remain_quantity," +
  "variations_warehouses(warehouse_id,remain_quantity,total_quantity,actual_remain_quantity)";

export const WAREHOUSE_COMPACT_MASK =
  "id,name,phone_number,address,full_address," +
  "province_id,district_id,commune_id," +
  "new_province_id,new_commune_id," +
  "allow_create_order";

// /geo/provinces, /geo/districts, /geo/communes share the same compact shape.
// Keeps id+name (display), new_id (OLD→NEW reform mapping post-2025-07-01),
// district_id+province_id (parent linkage for OLD format).
export const ADDRESS_LOOKUP_MASK = "id,name,new_id,district_id,province_id";
