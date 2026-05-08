import { z } from "zod";
import type { PancakeHttpClient } from "../api-client/pancake-http-client.js";
import { project } from "../shared/response-projection.js";
import { ADDRESS_LOOKUP_MASK } from "../shared/compact-masks.js";

const VerbositySchema = z
  .enum(["compact", "full"])
  .optional()
  .describe(
    "Response detail level. 'compact' (default) keeps id/name/new_id/district_id/province_id (~50% smaller). 'full' returns raw Pancake response (includes name_en, postcode, country_code, region_type).",
  );

/**
 * Vietnamese address lookup via Pancake `/geo/*` endpoints (verified 2026-04-28
 * on both pos.pages.fm and pos.pancake.vn with api_key).
 *
 * The server is polymorphic on `province_id`:
 * - OLD value (e.g. "805") → returns OLD 3-tier shape (commune items have
 *   `district_id` filled and a `new_id` field mapping to the NEW commune ID).
 * - NEW value (e.g. "84_VN132") → returns NEW 2-tier shape (commune items have
 *   `district_id: null`).
 *
 * `district_id` filter is OLD-only (the post-2025-07-01 administrative reform
 * removed the district level).
 *
 * Note: this previously hit `/address/*` paths which now return 404. The
 * `/geo/*` rename was discovered via Pancake POS web UI capture; behavior
 * confirmed by curl probes.
 */

const ProvincesAction = z.object({
  action: z.literal("provinces"),
  verbosity: VerbositySchema,
});

const DistrictsAction = z.object({
  action: z.literal("districts"),
  province_id: z.string().describe(
    "OLD-format province ID (e.g. '805'). NEW format has no districts.",
  ),
  verbosity: VerbositySchema,
});

const CommunesAction = z.object({
  action: z.literal("communes"),
  province_id: z.string().optional().describe(
    "Province ID — accepts OLD (e.g. '805') or NEW (e.g. '84_VN132'). " +
      "Server detects prefix: OLD returns 3-tier list, NEW returns 2-tier (no district level).",
  ),
  district_id: z.string().optional().describe(
    "OLD-format district ID — narrows OLD results to a single district. NEW format does not use this field.",
  ),
  verbosity: VerbositySchema,
});

export const addressLookupToolSchema = z.discriminatedUnion("action", [
  ProvincesAction,
  DistrictsAction,
  CommunesAction,
]);

export type AddressLookupToolInput = z.infer<typeof addressLookupToolSchema>;

export async function handleAddressLookupTool(
  args: AddressLookupToolInput,
  client: PancakeHttpClient,
) {
  const projectArr = (arr: unknown[], verbosity: "compact" | "full" | undefined) =>
    arr.map((item) => project(item, ADDRESS_LOOKUP_MASK, verbosity));

  switch (args.action) {
    case "provinces": {
      const result = await client.get<unknown[]>("geo/provinces");
      return { data: projectArr(result.data, args.verbosity) };
    }
    case "districts": {
      const result = await client.get<unknown[]>("geo/districts", {
        province_id: args.province_id,
      });
      return { data: projectArr(result.data, args.verbosity) };
    }
    case "communes": {
      if (!args.province_id && !args.district_id) {
        throw new Error(
          "communes lookup requires at least one of province_id (OLD or NEW) or district_id (OLD).",
        );
      }
      const params: Record<string, unknown> = {};
      if (args.province_id) params.province_id = args.province_id;
      if (args.district_id) params.district_id = args.district_id;
      const result = await client.get<unknown[]>("geo/communes", params);
      return { data: projectArr(result.data, args.verbosity) };
    }
  }
}
