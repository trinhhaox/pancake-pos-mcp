/**
 * Server-side sort values supported by Pancake POS orders list endpoint.
 * Source: docs/poscake-api-docs.md (option_sort).
 *
 * Pattern: `{field}_{desc|asc}`. Combine with `page_size=N` + `fields[]` for
 * cheap top-N analytics in 1 call (no pagination loop).
 */
export const ORDER_SORT_VALUES = [
  "inserted_at_desc",
  "inserted_at_asc",
  "last_updated_order_desc",
  "last_updated_order_asc",
  "last_update_status_at_desc",
  "last_update_status_at_asc",
  "order_valuation_desc",
  "order_valuation_asc",
  "product_quantity_desc",
  "product_quantity_asc",
  "product_name_desc",
  "product_name_asc",
  "sub_status_sort_desc",
  "sub_status_sort_asc",
  "first_undeliverable_at_desc",
  "first_undeliverable_at_asc",
  "customer_sort_desc",
  "customer_sort_asc",
] as const;

export type OrderSortValue = (typeof ORDER_SORT_VALUES)[number];

export const ORDER_SORT_DESCRIPTION = `Server-side sort. Pair with page_size=N + fields[] for top-N analytics in 1 call.

Common patterns:
- Top order by total → option_sort="order_valuation_desc", page_size=1, fields=["id","total_price","bill_full_name","inserted_at"]
- Newest orders → option_sort="inserted_at_desc"
- Top by item count → option_sort="product_quantity_desc"
- Recently updated → option_sort="last_updated_order_desc"

Allowed: ${ORDER_SORT_VALUES.join(", ")}`;
