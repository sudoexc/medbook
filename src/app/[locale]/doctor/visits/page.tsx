import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

/**
 * /doctor/visits — sidebar entry point. The actual history view lives at
 * /doctor/visits/[patientId] (per-patient, with header / AI panel / timeline).
 *
 * Pick the most relevant patient for the doctor *right now*:
 *   1. The IN_PROGRESS appointment if there is one (active reception);
 *   2. otherwise the patient of the most recent COMPLETED visit.
 * If neither exists (brand-new doctor with no caseload), fall through to
 * /doctor/patients so the doctor can pick someone manually.
 */
export default async function VisitsIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await auth();
  if (
    !session?.user ||
    session.user.role !== "DOCTOR" ||
    !session.user.clinicId
  ) {
    redirect(`/${locale}/login`);
  }

  const patientId = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: "DOCTOR",
    },
    async () => {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
      });
      if (!doctor) return null;

      const active = await prisma.appointment.findFirst({
        where: { doctorId: doctor.id, status: "IN_PROGRESS" },
        orderBy: { date: "desc" },
        select: { patientId: true },
      });
      if (active) return active.patientId;

      const lastCompleted = await prisma.appointment.findFirst({
        where: { doctorId: doctor.id, status: "COMPLETED" },
        orderBy: [{ date: "desc" }, { time: "desc" }],
        select: { patientId: true },
      });
      return lastCompleted?.patientId ?? null;
    },
  );

  if (!patientId) {
    redirect(`/${locale}/doctor/patients`);
  }
  redirect(`/${locale}/doctor/visits/${patientId}`);
}
