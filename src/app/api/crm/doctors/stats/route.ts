/**
 * GET /api/crm/doctors/stats?from=&to=[&doctorId=]
 *
 * Per-doctor aggregates (appointments, completed, no-show, cancelled,
 * revenue, today's count) for the doctors page and the doctor profile,
 * grouped in the database (audit DR-01): the pages used to pull raw rows
 * with a limit the list API refuses and rendered the 400 as zeros.
 *
 * Same audience as `GET /api/crm/appointments`, which already exposes these
 * numbers row by row; a DOCTOR only ever gets their own row.
 */
import { z } from "zod";

import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { loadDoctorStats } from "@/server/doctors/stats";

const QuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  doctorId: z.string().min(1).optional(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    let doctorId = parsed.value.doctorId;

    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const own = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!own || (doctorId && doctorId !== own.id)) return ok({ rows: [] });
      doctorId = own.id;
    }

    const rows = await loadDoctorStats({
      from: parsed.value.from,
      to: parsed.value.to,
      doctorId,
    });
    return ok({ rows });
  },
);
