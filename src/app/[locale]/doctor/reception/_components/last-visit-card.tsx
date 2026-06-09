"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowRightIcon, CalendarOffIcon } from "lucide-react";

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

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const TYPE_LABEL = {
  consultation: "Консультация",
  repeat: "Повторный приём",
} as const;

/**
 * Right-rail "Последний визит" card on /doctor/visits/[patientId].
 *
 * Reads the most recent COMPLETED appointment from the shared
 * `useDoctorPatientVisits` hook (newest-first; `rows[0]` is the latest visit)
 * — the same source the visits table/timeline on the page already consume,
 * so this rides the cached query with no extra round-trip.
 */
export function LastVisitCard({ patientId }: { patientId: string }) {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "ru";

  const query = useDoctorPatientVisits(patientId);
  const rows = flattenVisits(query.data);
  const last = rows[0] ?? null;

  if (query.isLoading) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний визит
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="mt-4 h-9 w-full rounded-xl" />
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний визит
        </div>
        <p className="text-xs text-destructive">
          Не удалось загрузить последний визит.
        </p>
      </section>
    );
  }

  if (!last) {
    return (
      <section className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="mb-3 text-[15px] font-semibold text-foreground">
          Последний визит
        </div>
        <EmptyState
          icon={<CalendarOffIcon />}
          title="Нет завершённых визитов"
          description="Как только приём будет завершён, он появится здесь."
          className="border-0 bg-transparent px-0 py-4"
        />
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="text-[15px] font-semibold text-foreground">
          Последний визит
        </div>
        <span className="inline-flex items-center rounded-md bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
          {TYPE_LABEL[last.type]}
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="text-sm font-semibold text-foreground tabular-nums">
          {longDate(last.date)}, {hhmm(last.date)} — {hhmm(last.endDate)}
        </div>
        <Row label="Врач" value={last.doctorName} />
        <Row
          label="Статус"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" />
              Завершён
            </span>
          }
        />
      </div>

      {last.visitNoteId ? (
        <Link
          href={`/${locale}/doctor/visits/${patientId}/${last.id}`}
          className="motion-press mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Открыть последний визит
          <ArrowRightIcon className="size-4" />
        </Link>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-border py-2 text-center text-xs text-muted-foreground">
          Заключение не оформлено
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
