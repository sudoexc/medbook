/**
 * /api/crm/ai/icd10-suggest — Phase 3b reception AI.
 *
 * POST { noteId, locale? } — returns 3–5 ranked ICD-10 codes drawn from
 * the curated `ICD10_ENTRIES` universe. Model picks from the list; we
 * project hallucinated codes onto null so the suggestion is always
 * resolvable by the inline search.
 */

import { createApiHandler } from "@/lib/api-handler";
import { ok, err, forbidden, notFound } from "@/server/http";
import { ReceptionAiInputSchema } from "@/server/schemas/reception-ai";
import { suggestIcd10Codes } from "@/server/ai/reception-icd10";

import { loadReceptionAiContext } from "../_lib/reception-context";

export const POST = createApiHandler(
  { roles: ["DOCTOR"], bodySchema: ReceptionAiInputSchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return forbidden();
    const loaded = await loadReceptionAiContext(body.noteId, ctx.userId);
    if (!loaded.ok) {
      if (loaded.status === 404) return notFound();
      return err("Forbidden", loaded.status, { reason: loaded.reason });
    }
    const { ctx: c } = loaded;
    const result = await suggestIcd10Codes(ctx.clinicId, ctx.userId, {
      patient: { age: c.patient.age, gender: c.patient.gender },
      complaints: c.note.complaints,
      examination: c.note.examination,
      anamnesis: c.note.anamnesis,
      locale: body.locale,
    });
    return ok(result);
  },
);
