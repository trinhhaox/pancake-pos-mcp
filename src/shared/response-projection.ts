import mask from "json-mask";

export type Verbosity = "compact" | "full";

/**
 * Project a Pancake API response through a json-mask whitelist.
 *
 * Default verbosity=compact strips all fields not in mask. Use verbosity="full"
 * to bypass projection (debug/migration).
 *
 * Mask syntax: Google partial-response
 *   - "id,name"            top-level pick
 *   - "items(id,quantity)" nested array projection
 *   - "data(id,items(id))" arbitrary depth
 *
 * Return type is `Partial<T>` because compact mode drops fields. When
 * verbosity="full" the runtime value is the original T but the static type
 * stays Partial<T> for safety; cast back if the caller needs strict access.
 */
export function project<T>(
  data: T,
  maskStr: string,
  verbosity: Verbosity = "compact",
): Partial<T> {
  if (verbosity === "full") return data;
  if (data === null || data === undefined) return data;
  if (Array.isArray(data)) {
    return data.map((d) => mask(d, maskStr)) as unknown as Partial<T>;
  }
  return mask(data, maskStr) as Partial<T>;
}
