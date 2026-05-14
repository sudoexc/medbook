/**
 * /api/crm/ai/warnings — Phase 3b reception AI (rules, no LLM).
 *
 * GET ?noteId=... — derives warnings from the VisitNote draft + patient
 * allergies. Fast, deterministic, doctor-scoped.
 */

import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { ok, err, forbidden, notFound, parseQuery } from "@/server/http";
import { deriveReceptionWarnings } from "@/server/ai/reception-warnings";

import { loadReceptionAiContext } from "../_lib/reception-context";

const Query = z.object({ noteId: z.string().min(1) });

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, Query);
    if (!parsed.ok) return parsed.response;
    if (ctx.kind !== "TENANT") return forbidden();

    const loaded = await loadReceptionAiContext(parsed.value.noteId, ctx.userId);
    if (!loaded.ok) {
      if (loaded.status === 404) return notFound();
      return err("Forbidden", loaded.status, { reason: loaded.reason });
    }
    const { ctx: c } = loaded;
    const warnings = deriveReceptionWarnings({
      prescriptions: c.note.prescriptions,
      examination: c.note.examination,
      allergies: c.allergies,
      hasAllergyRecord: c.hasAllergyRecord,
    });
    return ok({ warnings });
  },
);
