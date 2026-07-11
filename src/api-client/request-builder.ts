/**
 * Builds query string parameters from a flat object.
 * Pancake API expects array params as bracket-style repeated keys (`key[]=v1&key[]=v2`).
 * Sending JSON-encoded arrays triggers HTTP 500 on list endpoints.
 *
 * Live-verified 2026-05-06 against pos.pages.fm/api/v1/shops/{id}/orders:
 * - `fields%5B%5D=id` (URLSearchParams percent-encoded) → HTTP 200, projection works
 * - Literal `fields[]=id` → HTTP 200 (Pancake accepts both)
 * - `fields=["id"]` (JSON-encoded, old buggy behavior) → HTTP 500
 * - Nested `order_sources[]=["-1"]` (Option B, inner JSON), `order_sources[]=-1` (scalar),
 *   and `order_sources[][]=-1` (double-bracket) all return identical filtered counts —
 *   Pancake normalizes all three.
 */
export function buildQueryParams(params: Record<string, unknown>): URLSearchParams {
  const sp = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      for (const v of value) {
        if (v === undefined || v === null) continue;
        const encoded = Array.isArray(v) ? JSON.stringify(v) : String(v);
        if (encoded === "") continue;
        sp.append(`${key}[]`, encoded);
      }
    } else {
      sp.set(key, String(value));
    }
  }

  return sp;
}

/**
 * Encode each segment of a URL path, preserving slashes.
 * Prevents path traversal via user-supplied ID values.
 */
function encodePathSegments(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Build the full URL for a Pancake API request.
 * Injects /shops/{shopId}/ prefix and api_key query param.
 */
export function buildRequestUrl(
  baseUrl: string,
  shopId: string,
  apiKey: string,
  path: string,
  queryParams?: Record<string, unknown>,
): string {
  // Only `/geo/*` is truly global (no shop scope). `partners`, `address`, and
  // all other endpoints are shop-scoped and need the /shops/{id} prefix.
  const globalPrefixes = ["/geo", "geo"];
  const needsShopPrefix = !globalPrefixes.some((p) => path.startsWith(p));
  const safePath = encodePathSegments(path.replace(/^\//, ""));
  const relativePath = needsShopPrefix
    ? `shops/${encodeURIComponent(shopId)}${safePath ? `/${safePath}` : ""}`
    : safePath;
  const baseWithSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

  const url = new URL(relativePath, baseWithSlash);
  url.searchParams.set("api_key", apiKey);

  if (queryParams) {
    const built = buildQueryParams(queryParams);
    built.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
  }

  return url.toString();
}

/**
 * Redact api_key from URL for safe logging.
 */
export function redactUrl(url: string): string {
  return url.replace(/api_key=[^&]+/, "api_key=***");
}
