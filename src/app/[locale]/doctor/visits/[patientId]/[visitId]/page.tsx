import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeftIcon,
  PrinterIcon,
  StethoscopeIcon,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth";
import { formatPrescriptionLines } from "@/lib/catalogs/prescription-format";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { VisitNoteReadOnly } from "./_components/visit-note-readonly";
import { PrintVisitButton } from "./_components/print-visit-button";

/**
 * /doctor/visits/[patientId]/[visitId] — read-only view of a single
 * VisitNote belonging to the calling doctor.
 *
 * Access rule: the note must be owned by this doctor (same `doctorId`).
 * Cross-doctor reads would leak another caseload, even within the same
 * clinic, so we 404 rather than 403 to avoid signalling existence.
 *
 * Print path: `/api/crm/visit-notes/[id]/print?lang=ru` returns a
 * self-contained HTML doc with its own sticky print bar — the button on
 * this page opens that in a new tab so the doctor doesn't lose their
 * scroll position when toggling to print preview.
 */
export default async function VisitDetailPage({
  params,
}: {
  params: Promise<{ locale: string; patientId: string; visitId: string }>;
}) {
  const { locale, patientId, visitId } = await params;
  const session = await auth();
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

      const note = await prisma.visitNote.findUnique({
        where: { id: visitId },
        select: {
          id: true,
          doctorId: true,
          patientId: true,
          status: true,
          startedAt: true,
          finalizedAt: true,
          diagnosisCode: true,
          diagnosisName: true,
          complaints: true,
          anamnesis: true,
          examination: true,
          prescriptions: true,
          visitPrescriptions: { orderBy: { sortOrder: "asc" } },
          advice: true,
          bodyMarkdown: true,
          aiGenerated: true,
          appointment: {
            select: {
              id: true,
              date: true,
              endDate: true,
              time: true,
              primaryService: { select: { nameRu: true } },
            },
          },
          patient: {
            select: { id: true, fullName: true, phone: true },
          },
        },
      });

      // 404 when the note doesn't exist, belongs to another doctor, or the
      // URL's patientId doesn't match the note's patient. The last guard
      // makes link-tampering inert.
      if (!note) return null;
      if (note.doctorId !== doctor.id) return null;
      if (note.patientId !== patientId) return null;

      return { note, doctor };
    },
  );

  if (!data) notFound();

  const t = await getTranslations("doctor.visits");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-4 xl:p-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/${locale}/doctor/visits/${patientId}`}
          className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeftIcon className="size-4" />
          {t("actions.backToHistory")}
        </Link>
        <PrintVisitButton visitNoteId={data.note.id}>
          <PrinterIcon className="size-4" />
          {t("actions.printPdf")}
        </PrintVisitButton>
      </div>

      <header className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <StethoscopeIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-foreground">
              {data.note.patient.fullName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {data.doctor.nameRu} · {data.doctor.specializationRu}
            </p>
          </div>
          <StatusBadge
            status={data.note.status}
            finalizedLabel={t("status.finalized")}
            draftLabel={t("status.draft")}
          />
        </div>
      </header>

      <VisitNoteReadOnly
        note={{
          id: data.note.id,
          status: data.note.status as "DRAFT" | "FINALIZED",
          startedAt: data.note.startedAt
            ? data.note.startedAt.toISOString()
            : null,
          finalizedAt: data.note.finalizedAt
            ? data.note.finalizedAt.toISOString()
            : null,
          diagnosisCode: data.note.diagnosisCode,
          diagnosisName: data.note.diagnosisName,
          complaints: data.note.complaints,
          anamnesis: data.note.anamnesis,
          examination: data.note.examination,
          prescriptions: [
            ...formatPrescriptionLines(
              data.note.visitPrescriptions,
              locale === "uz" ? "uz" : "ru",
              { withInstruction: true },
            ),
            ...data.note.prescriptions,
          ],
          advice: data.note.advice,
          bodyMarkdown: data.note.bodyMarkdown,
          aiGenerated: data.note.aiGenerated,
          appointment: data.note.appointment
            ? {
                date: data.note.appointment.date.toISOString(),
                endDate: data.note.appointment.endDate.toISOString(),
                time: data.note.appointment.time,
                serviceName:
                  data.note.appointment.primaryService?.nameRu ?? null,
              }
            : null,
        }}
      />
    </div>
  );
}

function StatusBadge({
  status,
  finalizedLabel,
  draftLabel,
}: {
  status: string;
  finalizedLabel: string;
  draftLabel: string;
}) {
  const isFinalized = status === "FINALIZED";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        isFinalized
          ? "bg-success/15 text-success"
          : "bg-warning/15 text-warning"
      }`}
    >
      {isFinalized ? finalizedLabel : draftLabel}
    </span>
  );
}
