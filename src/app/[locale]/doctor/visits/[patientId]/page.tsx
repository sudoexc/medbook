import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeftIcon, UploadIcon } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { AISummaryPanel } from "../../reception/_components/ai-summary-panel";
import { LastDiagnosisCard } from "../../reception/_components/last-diagnosis-card";
import { LastVisitCard } from "../../reception/_components/last-visit-card";
import { VisitsFilters } from "../../reception/_components/visits-filters";
import { PatientHeaderLive } from "./_components/patient-header-live";
import { PatientMetaRowLive } from "./_components/patient-meta-row-live";
import { VisitsList } from "./_components/visits-list";

/**
 * /doctor/visits/[patientId] — full visit history this doctor has had with
 * the given patient. Server component pre-fetches the patient header data
 * (so the page paints with real name / age / phone immediately); the
 * timeline + table are client-side via `useInfiniteQuery` for cheap
 * paginated scroll.
 *
 * Access rule: the patient must (a) exist in the doctor's clinic, and (b)
 * have at least one appointment with this doctor. Anything else falls
 * through to a notFound() — surfacing a clinic-wide patient on the doctor
 * surface would leak names across caseloads.
 */
export default async function VisitsPage({
  params,
}: {
  params: Promise<{ locale: string; patientId: string }>;
}) {
  const { locale, patientId } = await params;
  const session = await auth();
  // The doctor layout already guards `/doctor/*` for role + clinicId, but
  // duplicating the checks here lets us derive the typed values cleanly.
  if (!session?.user || session.user.role !== "DOCTOR" || !session.user.clinicId) {
    redirect(`/${locale}/login`);
  }

  const data = await runWithTenant(
    {
      kind: "TENANT",
      clinicId: session.user.clinicId,
      userId: session.user.id,
      role: "DOCTOR",
    },
    async () => {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: session.user.id },
        select: { id: true, nameRu: true, specializationRu: true },
      });
      if (!doctor) return null;

      const patient = await prisma.patient.findFirst({
        where: { id: patientId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          birthDate: true,
          photoUrl: true,
          gender: true,
          segment: true,
        },
      });
      if (!patient) return null;

      // The patient must have a relationship with this doctor — otherwise
      // we'd be surfacing a clinic-wide patient under the doctor's own UI.
      const relationship = await prisma.appointment.findFirst({
        where: { patientId, doctorId: doctor.id },
        select: { id: true },
      });
      if (!relationship) return null;

      const [activeAppt, lastVisit, allergies, chronic] = await Promise.all([
        prisma.appointment.findFirst({
          where: { patientId, doctorId: doctor.id, status: "IN_PROGRESS" },
          select: { id: true },
        }),
        prisma.appointment.findFirst({
          where: { patientId, doctorId: doctor.id, status: "COMPLETED" },
          orderBy: { date: "desc" },
          select: { date: true, time: true },
        }),
        prisma.patientAllergy.findMany({
          where: { patientId },
          select: { substance: true, severity: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.patientChronicCondition.findMany({
          where: { patientId, isActive: true },
          select: { name: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

      const totalCompleted = await prisma.appointment.count({
        where: { patientId, doctorId: doctor.id, status: "COMPLETED" },
      });

      return {
        patient,
        doctor,
        activeAppointmentId: activeAppt?.id ?? null,
        lastVisit,
        allergies,
        chronic,
        totalCompleted,
      };
    },
  );

  if (!data) notFound();

  return (
    <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:gap-5">
        <Link
          href={`/${locale}/doctor/patients`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          К списку пациентов
        </Link>

        <PatientHeaderLive
          fullName={data.patient.fullName}
          phone={data.patient.phone}
          birthDateIso={
            data.patient.birthDate ? data.patient.birthDate.toISOString() : null
          }
          photoUrl={data.patient.photoUrl}
          hasActiveAppointment={data.activeAppointmentId !== null}
          lastVisit={
            data.lastVisit
              ? {
                  dateIso: data.lastVisit.date.toISOString(),
                  time: data.lastVisit.time,
                }
              : null
          }
          cardNumber={data.patient.id.slice(-6).toUpperCase()}
        />

        <PatientMetaRowLive
          allergies={data.allergies.map((a) => ({
            substance: a.substance,
            severity: a.severity,
          }))}
          chronicConditions={data.chronic.map((c) => c.name)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">История визитов</h1>
          {/*
           * Anchor with `download` so the browser triggers a save dialog
           * instead of navigating; the endpoint already sets
           * `Content-Disposition: attachment` so this is defence in depth.
           */}
          <a
            href={`/api/crm/doctors/me/patients/${patientId}/visits/export?format=csv`}
            download
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            <UploadIcon className="size-4 text-muted-foreground" />
            Экспорт CSV
          </a>
        </div>

        <VisitsFilters />
        <VisitsList
          patientId={patientId}
          totalCompleted={data.totalCompleted}
        />
      </div>

      <aside className="hidden w-[320px] shrink-0 flex-col gap-4 xl:flex xl:gap-5">
        <AISummaryPanel
          patientId={patientId}
          chronicConditions={data.chronic.map((c) => c.name)}
        />
        <LastVisitCard patientId={patientId} />
        <LastDiagnosisCard patientId={patientId} />
      </aside>
    </div>
  );
}
