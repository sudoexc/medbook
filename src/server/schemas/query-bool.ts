import { z } from "zod";

/**
 * A boolean query-string flag (`?rxOnly=false`, `?isActive=true`).
 *
 * `z.coerce.boolean()` is `Boolean(input)`, and every non-empty string is
 * truthy, so `"false"` parsed as `true` (audit CT-12): the «Без рецепта» chip
 * sent `rxOnly=false` and the catalog answered with prescription drugs only.
 * This accepts the spellings a URL actually carries ("true"/"false",
 * "1"/"0", "yes"/"no", "on"/"off", any case) plus a real boolean for callers
 * that parse an object, treats an empty value (`?flag=`) as absent, and
 * refuses anything else instead of guessing.
 */
export function queryBool() {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.union([z.boolean(), z.stringbool()]).optional(),
  );
}
