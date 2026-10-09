/**
 * «Позвать регистратуру» (owner request 09.10.2026, src/lib/staff-calls.ts).
 *
 * GET  — a doctor gets his latest call (`{ call }`, or null); the desk and
 *        the clinic's admins get the calls still ringing (`{ calls }`).
 * POST — the doctor calls the desk. A call already ringing is rung again
 *        (the desk gets the alert once more) rather than doubled.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import {
  STAFF_CALL_ACK_KEPT_MS,
  STAFF_CALL_ANSWER_ROLES,
  STAFF_CALL_CALLER_ROLES,
  staffCallOpenSince,
} from "@/lib/staff-calls";
import { err, ok } from "@/server/http";
import { publishStaffCall, STAFF_CALL_SELECT, toStaffCallView } from "@/server/staff-calls";

/** A worried doctor pressing again and again still gets through; a stuck client does not. */
const CALLS_PER_HOUR = 40;

async function doctorOf(userId: string) {
  return prisma.doctor.findFirst({ where: { userId }, select: { id: true } });
}

export const GET = createApiListHandler(
  { roles: [...STAFF_CALL_CALLER_ROLES, ...STAFF_CALL_ANSWER_ROLES] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const now = new Date();
    if (ctx.role === "DOCTOR") {
      const doctor = await doctorOf(ctx.userId);
      if (!doctor) return ok({ call: null, now: now.toISOString() });
      const row = await prisma.staffCall.findFirst({
        where: {
          doctorId: doctor.id,
          OR: [
            { status: "OPEN", createdAt: { gte: staffCallOpenSince(now) } },
            { status: "ACKED", ackedAt: { gte: new Date(now.getTime() - STAFF_CALL_ACK_KEPT_MS) } },
          ],
        },
        orderBy: { createdAt: "desc" },
        select: STAFF_CALL_SELECT,
      });
      // `now`: the screens count «N мин назад» and the doctor's state on the
      // server's clock; a clinic PC's own clock may be hours off.
      return ok({ call: row ? toStaffCallView(row) : null, now: now.toISOString() });
    }
    const rows = await prisma.staffCall.findMany({
      where: { status: "OPEN", createdAt: { gte: staffCallOpenSince(now) } },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: STAFF_CALL_SELECT,
    });
    return ok({ calls: rows.map(toStaffCallView), now: now.toISOString() });
  },
);

export const POST = createApiHandler(
  { roles: [...STAFF_CALL_CALLER_ROLES] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    if (!rateLimit(`staff-call:${ctx.userId}`, CALLS_PER_HOUR, 3_600_000, "staff-calls")) {
      return err("TooManyRequests", 429, { reason: "staff_call_rate_limited" });
    }
    const doctor = await doctorOf(ctx.userId);
    if (!doctor) return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });

    const ringing = await prisma.staffCall.findFirst({
      where: { doctorId: doctor.id, status: "OPEN", createdAt: { gte: staffCallOpenSince() } },
      orderBy: { createdAt: "desc" },
      select: STAFF_CALL_SELECT,
    });
    const row =
      ringing ??
      (await prisma.staffCall.create({
        data: { clinicId: ctx.clinicId, doctorId: doctor.id, createdById: ctx.userId },
        select: STAFF_CALL_SELECT,
      }));
    const call = toStaffCallView(row);
    publishStaffCall(ctx.clinicId, call);
    return ok({ call, repeated: Boolean(ringing) });
  },
);
