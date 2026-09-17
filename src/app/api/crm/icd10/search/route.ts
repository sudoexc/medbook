/**
 * /api/crm/icd10/search?q=... — type-ahead source for the diagnosis picker.
 *
 * Ranking lives in `@/server/icd10/search` so it can be unit-tested without a
 * request. The catalog is the full 10 414-code classifier; picking the first N
 * matches in catalog order (what this route used to do) would return chapter A
 * codes for a query about migraine, so results are scored instead.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok, parseQuery } from "@/server/http";
import { z } from "zod";

import { searchIcd10 } from "@/server/icd10/search";
import { searchClinicCatalog } from "@/server/icd10/clinic-catalog";

const QuerySchema = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE"] },
  async ({ request }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const { q, limit } = parsed.value;

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
