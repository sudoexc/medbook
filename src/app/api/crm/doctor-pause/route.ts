/**
 * «Перерыв» / «Обед» for the signed-in doctor (owner request 09.10.2026).
 *
 * GET  — `{ pause }`: his open pause, or null.
 * POST — `{ kind: "BREAK" | "LUNCH" }`: starts one. Pressing the other kind
 *        while paused switches (the open one ends, the new one starts);
 *        pressing the same kind again changes nothing.
 * His TV shows the pause instead of the queue (src/server/doctor-pause.ts).
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { DOCTOR_PAUSE_KINDS } from "@/lib/doctor-pause";
import { err, ok } from "@/server/http";
import { currentDoctorPause, publishDoctorPauseChanged } from "@/server/doctor-pause";

const StartPauseSchema = z.object({ kind: z.enum(DOCTOR_PAUSE_KINDS) });

async function doctorOf(userId: string) {
  return prisma.doctor.findFirst({ where: { userId }, select: { id: true } });
}

export const GET = createApiListHandler({ roles: ["DOCTOR"] }, async ({ ctx }) => {
  if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
  const doctor = await doctorOf(ctx.userId);
  if (!doctor) return ok({ pause: null });
  return ok({ pause: await currentDoctorPause(doctor.id) });
});

export const POST = createApiHandler<z.infer<typeof StartPauseSchema>>(
  { roles: ["DOCTOR"], bodySchema: StartPauseSchema },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    if (!rateLimit(`doctor-pause:${ctx.userId}`, 120, 3_600_000, "doctor-pause")) {
      return err("TooManyRequests", 429, { reason: "doctor_pause_rate_limited" });
    }
    const doctor = await doctorOf(ctx.userId);
    if (!doctor) return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });

    const open = await currentDoctorPause(doctor.id);
    if (open?.kind === body.kind) return ok({ pause: open });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      // Ends whatever is open, today's or a forgotten older one.
      await tx.doctorPause.updateMany({
        where: { doctorId: doctor.id, endedAt: null },
        data: { endedAt: now },
      });
      await tx.doctorPause.create({
        data: {
          clinicId: ctx.clinicId,
          doctorId: doctor.id,
          kind: body.kind,
          startedAt: now,
          createdById: ctx.userId,
        },
      });
    });
    publishDoctorPauseChanged(ctx.clinicId, doctor.id);
    return ok({ pause: await currentDoctorPause(doctor.id) });
  },
);
