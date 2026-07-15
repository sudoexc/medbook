"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronRightIcon, FileTextIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  useDoctorPatientVisits,
  flattenVisits,
} from "../../patients/_hooks/use-doctor-patient-visits";
import { useReceptionContext } from "../_hooks/reception-context";

export function HistoryDocsCard() {
  const t = useTranslations("doctor.reception");
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";
  const { activeAppointment } = useReceptionContext();
  const patientId = activeAppointment?.patient.id ?? null;

  const q = useDoctorPatientVisits(patientId);
  const rows = flattenVisits(q.data).slice(0, 5);

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-border bg-card">
      <div className="flex min-w-0 items-center gap-0.5 border-b border-border px-2 pt-2">
        <div className="relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap px-2 text-sm font-medium text-foreground">
          {t("historyDocs.tab")}
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary tabular-nums">
            {rows.length}
          </span>
          <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
        </div>
      </div>

      {!patientId ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("historyDocs.selectPatient")}
        </p>
      ) : q.isLoading ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("common.loading")}
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t("historyDocs.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((v) => {
            const inner = (
              <>
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileTextIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-foreground">
                    {v.diagnosisCode
                      ? `${v.diagnosisCode}${v.diagnosisName ? ` · ${v.diagnosisName}` : ""}`
                      : (v.serviceName ?? t("common.consultation"))}
                  </div>
                  <div className="truncate text-xs text-muted-foreground tabular-nums">
                    {new Date(v.date).toLocaleDateString("ru-RU", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}{" "}
                    · {v.doctorName}
                  </div>
                </div>
                <ChevronRightIcon
                  className={cn(
                    "size-4 shrink-0",
                    v.visitNoteId
                      ? "text-muted-foreground"
                      : "text-transparent",
                  )}
                />
              </>
            );
            return (
              <li key={v.id}>
                {v.visitNoteId ? (
                  <Link
                    href={`/${locale}/doctor/visits/${patientId}/${v.visitNoteId}`}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 px-4 py-2.5">
                    {inner}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
