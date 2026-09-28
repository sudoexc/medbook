/**
 * POST /api/miniapp/links?clinicSlug=… — mint a short-lived link for a
 * surface a browser opens without our headers (audit MA-07).
 *
 *   { scope: "ics", appointmentId, onBehalfOf? } → { url }
 *       the calendar file of one appointment of the patient (or of a
 *       relative they act for), opened via `tg.openLink`;
 *   { scope: "events" } → { token }
 *       opens the patient's event stream (EventSource cannot send headers).
 *
 * Authenticated by the initData header like every Mini App call; the link
 * it returns opens that one thing for minutes and nothing else. Document
 * and conclusion links need no call: the lists mint them into `fileUrl` /
 * `conclusionUrl`.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { forbidden, notFound, ok } from "@/server/http";
import { createMiniAppHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { mintMiniAppLink } from "@/server/miniapp/link-token";

const Body = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("ics"),
    appointmentId: z.string().min(1).max(64),
    onBehalfOf: z.string().min(1).max(64).optional(),
  }),
  z.object({ scope: z.literal("events") }),
]);

export const POST = createMiniAppHandler(
  { bodySchema: Body },
  async ({ body, ctx }) => {
    if (body.scope === "events") {
      return ok({
        token: mintMiniAppLink({
          scope: "events",
          clinicId: ctx.clinicId,
          patientId: ctx.patientId,
          resourceId: ctx.patientId,
        }),
      });
    }

    const acting = await resolveActivePatient({
      ctx: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        preferredLang: ctx.patient.preferredLang,
      },
      onBehalfOf: body.onBehalfOf ?? null,
    });
    if (!acting.ok) return forbidden();
    const appt = await prisma.appointment.findFirst({
      where: { id: body.appointmentId, clinicId: ctx.clinicId },
      select: { id: true, patientId: true },
    });
    if (!appt) return notFound();
    if (appt.patientId !== acting.patientId) return forbidden();

    const token = mintMiniAppLink({
      scope: "ics",
      clinicId: ctx.clinicId,
      patientId: acting.patientId,
      resourceId: appt.id,
    });
    return ok({
      url: `/api/miniapp/appointments/${encodeURIComponent(appt.id)}/ics?clinicSlug=${encodeURIComponent(ctx.clinicSlug)}&t=${encodeURIComponent(token)}`,
    });
  },
);
