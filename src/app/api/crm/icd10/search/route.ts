/**
 * /api/crm/icd10/search — type-ahead source for the diagnosis picker, plus
 * two catalog-drawer modes:
 *   ?q=...            ranked search (clinic-learned entries first)
 *   ?range=A00-B99    browse an ICD chapter, code order, offset/limit paging
 *   ?codes=G43.0,M54  resolve exact codes (favorites chips need names)
 *
 * Ranking lives in `@/server/icd10/search` so it can be unit-tested without a
 * request. The catalog is the full 10 414-code classifier; picking the first N
 * matches in catalog order (what this route used to do) would return chapter A
 * codes for a query about migraine, so results are scored instead.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok, parseQuery } from "@/server/http";
import { z } from "zod";

import { ICD10_ENTRIES } from "@/server/icd10/data";
import { searchIcd10 } from "@/server/icd10/search";
import { searchClinicCatalog } from "@/server/icd10/clinic-catalog";

const QuerySchema = z.object({
  q: z.string().optional(),
  /** Chapter browse: "A00-B99". Takes precedence over q when present. */
  range: z
    .string()
    .regex(/^[A-Z][0-9]{2}-[A-Z][0-9]{2}$/)
    .optional(),
  /** Exact-code resolve, comma-separated. Takes precedence over both. */
  codes: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(12),
  offset: z.coerce.number().int().min(0).default(0),
});

/** First three characters of a code ("G43.0" → "G43") — the chapter key. */
function codeKey(code: string): string {
  return code.slice(0, 3).toUpperCase();
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { q, range, codes, limit, offset } = parsed.value;

    // Exact-code resolve — favorites chips store only the code and need the
    // wording back. Checks the static catalog first, then the clinic's
    // learned entries (a favourite may be a clinic-taught code).
    if (codes) {
      const wanted = codes
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 100);
      const bySet = new Set(wanted);
      const stat = ICD10_ENTRIES.filter((e) =>
        bySet.has(e.code.toUpperCase()),
      );
      const found = new Set(stat.map((e) => e.code.toUpperCase()));
      const missing = wanted.filter((c) => !found.has(c));
      const custom =
        missing.length > 0
          ? (
              await Promise.all(
                missing.map((c) => searchClinicCatalog(c, 1)),
              )
            )
              .flat()
              .filter((r) => r.code && bySet.has(r.code.toUpperCase()))
          : [];
      // Preserve the requested order — the chips render in favorites order.
      const byCode = new Map<string, { code: string; nameRu: string }>();
      for (const e of [...stat, ...custom])
        byCode.set(e.code.toUpperCase(), { code: e.code, nameRu: e.nameRu });
      const rows = wanted
        .map((c) => byCode.get(c))
        .filter((r): r is { code: string; nameRu: string } => !!r);
      return ok({ rows });
    }

    // Chapter browse — static entries in code order within the range. The
    // classifier's block codes are uniform 3-char keys, so lexicographic
    // compare on the A00/B99 bounds is exact.
    if (range) {
      const [lo, hi] = range.split("-") as [string, string];
      const all = ICD10_ENTRIES.filter((e) => {
        const k = codeKey(e.code);
        return k >= lo && k <= hi;
      });
      return ok({
        rows: all.slice(offset, offset + limit),
        total: all.length,
      });
    }

    // Clinic-learned entries first: they exist because a doctor of THIS
    // clinic signed them, which beats generic catalog relevance. The static
    // list fills the remainder; exact static duplicates are dropped.
    const custom = await searchClinicCatalog(q ?? "", limit);
    const seen = new Set(
      custom.map((c) => `${c.code.toLowerCase()}|${c.nameRu.toLowerCase()}`),
    );
    const stat = searchIcd10(q ?? "", limit).filter(
      (r) => !seen.has(`${r.code.toLowerCase()}|${r.nameRu.toLowerCase()}`),
    );
    return ok({ rows: [...custom, ...stat].slice(0, limit) });
  },
);
