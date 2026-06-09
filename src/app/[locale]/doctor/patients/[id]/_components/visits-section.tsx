"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRightIcon, FileTextIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  flattenVisits,
  useDoctorPatientVisits,
} from "../../_hooks/use-doctor-patient-visits";

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

function ruDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${RU_MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

export function VisitsSection({
  patientId,
  locale,
}: {
  patientId: string;
  locale: string;
}) {
  const t = useTranslations("doctor.patients");
  const list = useDoctorPatientVisits(patientId);
  const rows = flattenVisits(list.data);

  const sentinel = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          list.hasNextPage &&
          !list.isFetchingNextPage
        ) {
          list.fetchNextPage();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [list]);

  if (list.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-12 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        {t("visits.loading")}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
        {t("visits.loadError")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("visits.empty")}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((v) => (
          <li key={v.id}>
            <Link
              href={`/${locale}/doctor/visits/${patientId}/${v.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileTextIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {v.diagnosisCode ? (
                    <>
                      <span className="font-mono">{v.diagnosisCode}</span>
                      {v.diagnosisName ? ` · ${v.diagnosisName}` : ""}
                    </>
                  ) : (
                    t("visits.noDiagnosis")
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {ruDate(v.date)} · {t("visits.durationMin", { min: v.durationMin })} ·{" "}
                  {v.type === "repeat"
                    ? t("visits.type.repeat")
                    : t("visits.type.consultation")}
                  {v.serviceName ? ` · ${v.serviceName}` : ""}
                </div>
              </div>
              <ChevronRightIcon className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
      <div ref={sentinel} />
      {list.isFetchingNextPage && (
        <div className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {t("loadingMore")}
        </div>
      )}
    </section>
  );
}
