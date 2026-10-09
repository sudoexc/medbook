/**
 * POST /api/crm/doctor-pause/end — «Закончить перерыв / обед»: the doctor
 * is back; his TV says «Врач снова принимает» and shows the queue again.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { publishDoctorPauseChanged } from "@/server/doctor-pause";

export const POST = createApiHandler({ roles: ["DOCTOR"] }, async ({ ctx }) => {
  if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
  const doctor = await prisma.doctor.findFirst({ where: { userId: ctx.userId }, select: { id: true } });
  if (!doctor) return err("DoctorProfileMissing", 403, { reason: "no_doctor_row" });
  const ended = await prisma.doctorPause.updateMany({
    where: { doctorId: doctor.id, endedAt: null },
    data: { endedAt: new Date() },
  });
  if (ended.count > 0) publishDoctorPauseChanged(ctx.clinicId, doctor.id);
  return ok({ pause: null });
});
