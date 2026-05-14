/**
 * /api/crm/ai/clarifying-questions — Phase 3b reception AI.
 *
 * POST { noteId, locale? } — server loads the VisitNote draft + patient
 * history (doctor-scoped) and asks the LLM for 3–5 clarifying questions.
 * Falls back to a fixed list when the model fails.
 */

import { createApiHandler } from "@/lib/api-handler";
import { ok, err, forbidden, notFound } from "@/server/http";
import { ReceptionAiInputSchema } from "@/server/schemas/reception-ai";
import { generateClarifyingQuestions } from "@/server/ai/reception-clarifying";

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
    const result = await generateClarifyingQuestions(ctx.clinicId, ctx.userId, {
      patient: {
        fullName: c.patient.fullName,
        age: c.patient.age,
        gender: c.patient.gender,
      },
      draft: {
        complaints: c.note.complaints,
        anamnesis: c.note.anamnesis,
        examination: c.note.examination,
        diagnosisCode: c.note.diagnosisCode,
        diagnosisName: c.note.diagnosisName,
      },
      recentVisits: c.recentVisits,
      locale: body.locale,
    });
    return ok(result);
  },
);
