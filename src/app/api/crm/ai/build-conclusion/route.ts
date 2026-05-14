/**
 * /api/crm/ai/build-conclusion — Phase 3b reception AI.
 *
 * POST { noteId, locale? } — assembles the structured fields into a
 * full conclusion in markdown. The endpoint deliberately returns the
 * draft text rather than persisting it; the doctor reviews and decides
 * whether to overwrite `bodyMarkdown` via a separate PATCH.
 */

import { createApiHandler } from "@/lib/api-handler";
import { ok, err, forbidden, notFound } from "@/server/http";
import { ReceptionAiInputSchema } from "@/server/schemas/reception-ai";
import { buildConclusionMarkdown } from "@/server/ai/reception-conclusion";

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
    const result = await buildConclusionMarkdown(ctx.clinicId, ctx.userId, {
      patient: {
        fullName: c.patient.fullName,
        age: c.patient.age,
        gender: c.patient.gender,
      },
      complaints: c.note.complaints,
      anamnesis: c.note.anamnesis,
      examination: c.note.examination,
      prescriptions: c.note.prescriptions,
      advice: c.note.advice,
      diagnosisCode: c.note.diagnosisCode,
      diagnosisName: c.note.diagnosisName,
      locale: body.locale,
    });
    return ok(result);
  },
);
