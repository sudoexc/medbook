/**
 * /api/crm/icd10/search?q=... — type-ahead source for the diagnosis picker
 * on /doctor/reception. Linear scan over an in-memory curated list — fine at
 * ~150 entries; when the list grows we'll move to a Prisma table.
 *
 * Returns up to 12 matches. Empty query returns the first 12 (common Z/R
 * codes appear early in the data so the picker has something useful before
 * the doctor types).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { ok, parseQuery } from "@/server/http";
import { z } from "zod";

import { ICD10_ENTRIES } from "@/server/icd10/data";

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

    const term = (q ?? "").trim().toLowerCase();
    if (!term) {
      return ok({ rows: ICD10_ENTRIES.slice(0, limit) });
    }

    const matches: typeof ICD10_ENTRIES = [];
    // Prefer code prefix matches (most common pattern: doctor types "F41").
    for (const e of ICD10_ENTRIES) {
      if (e.code.toLowerCase().startsWith(term)) matches.push(e);
      if (matches.length >= limit) break;
    }
    if (matches.length < limit) {
      for (const e of ICD10_ENTRIES) {
        if (matches.includes(e)) continue;
        if (e.nameRu.toLowerCase().includes(term)) matches.push(e);
        if (matches.length >= limit) break;
      }
    }

    return ok({ rows: matches });
  },
);
