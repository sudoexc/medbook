"use client";

import { StethoscopeIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  flattenVisits,
  useDoctorPatientVisits,
} from "../../patients/_hooks/use-doctor-patient-visits";

const RU_MONTHS_SHORT = [
  "янв.",
  "февр.",
  "мар.",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function longDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()] ?? ""} ${d.getFullYear()}`;
}

/**
 * Right-rail "Последний диагноз" card on /doctor/visits/[patientId].
 *
 * Surfaces `VisitNote.diagnosisCode/diagnosisName` from the latest COMPLETED
 * visit that actually carries a diagnosis (the most recent visit may have no
 * note yet). Same shared `useDoctorPatientVisits` source as the visits list.
 */
export function LastDiagnosisCard({ patientId }: { patientId: string }) {
  const query = useDoctorPatientVisits(patientId);
  const rows = flattenVisits(query.data);
  const withDiagnosis =
    rows.find((v) => v.diagnosisCode || v.diagnosisName) ?? null;

  if (query.isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний диагноз
        </div>
        <Skeleton className="h-4 w-48" />
        <div className="mt-3 space-y-1.5">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний диагноз
        </div>
        <p className="text-xs text-destructive">
          Не удалось загрузить диагноз.
        </p>
      </section>
    );
  }

  if (!withDiagnosis) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний диагноз
        </div>
        <EmptyState
          icon={<StethoscopeIcon />}
          title="Диагноз не указан"
          description="В завершённых визитах ещё нет установленного диагноза."
          className="border-0 bg-transparent px-0 py-4"
        />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 text-[15px] font-semibold text-foreground">
        Последний диагноз
      </div>

      <div className="text-sm font-bold text-foreground">
        {withDiagnosis.diagnosisCode ? (
          <span className="tabular-nums">{withDiagnosis.diagnosisCode}</span>
        ) : null}{" "}
        {withDiagnosis.diagnosisName ?? ""}
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <Row label="Установлен" value={longDate(withDiagnosis.date)} />
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
