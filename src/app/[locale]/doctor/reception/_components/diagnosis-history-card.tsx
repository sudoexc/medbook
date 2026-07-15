"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRightIcon, StethoscopeIcon } from "lucide-react";

import { useReceptionContext } from "../_hooks/reception-context";
import { usePatientDiagnoses } from "../_hooks/use-patient-diagnoses";

/**
 * «История диагнозов» — the patient's full ICD-10 diagnosis history across
 * all doctors, newest first. Each row opens that visit's conclusion. Sits in
 * the bottom card row where the today-queue used to be.
 */
export function DiagnosisHistoryCard() {
  const t = useTranslations("doctor.reception");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const { activeAppointment } = useReceptionContext();
  const patientId = activeAppointment?.patient.id ?? null;

  const q = usePatientDiagnoses(patientId);
  const rows = q.data ?? [];

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <header className="flex min-w-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="truncate text-sm font-semibold text-foreground">
          {t("diagnosisHistory.title")}
        </h3>
        {rows.length > 0 ? (
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {rows.length}
          </span>
        ) : null}
      </header>

      {!patientId ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("diagnosisHistory.selectPatient")}
        </p>
      ) : q.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("diagnosisHistory.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((d) => (
            <li key={d.visitNoteId}>
              <Link
                href={`/${locale}/doctor/visits/${patientId}/${d.visitNoteId}`}
                className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <StethoscopeIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    <span className="font-semibold tabular-nums">
                      {d.diagnosisCode}
                    </span>
                    {d.diagnosisName ? (
                      <span className="text-foreground/80"> · {d.diagnosisName}</span>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground tabular-nums">
                    {new Date(d.date).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}{" "}
                    · {d.doctorName}
                  </div>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
