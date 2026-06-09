"use client";

import * as React from "react";
import { FileTextIcon, Loader2Icon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  flattenDocuments,
  useDoctorPatientDocuments,
} from "../../_hooks/use-doctor-patient-documents";

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

function formatBytes(
  n: number | null,
  units: { b: string; kb: string; mb: string },
): string {
  if (!n) return "";
  if (n < 1024) return `${n} ${units.b}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${units.kb}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${units.mb}`;
}

export function DocumentsSection({ patientId }: { patientId: string }) {
  const t = useTranslations("doctor.patients");
  const list = useDoctorPatientDocuments(patientId);
  const rows = flattenDocuments(list.data);
  const byteUnits = {
    b: t("documents.bytes.b"),
    kb: t("documents.bytes.kb"),
    mb: t("documents.bytes.mb"),
  };

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
        {t("documents.loading")}
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">
        {t("documents.loadError")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
        {t("documents.empty")}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card">
      <ul className="divide-y divide-border">
        {rows.map((d) => {
          const meta = [
            d.type,
            d.uploadedBy?.name,
            formatBytes(d.sizeBytes, byteUnits),
          ].filter(Boolean);
          return (
            <li
              key={d.id}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted"
            >
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileTextIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {d.title}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {ruDate(d.createdAt)}
                  {meta.length > 0 ? ` · ${meta.join(" · ")}` : ""}
                </div>
              </div>
              <a
                href={d.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={t("documents.open")}
              >
                <DownloadIcon className="size-4" />
              </a>
            </li>
          );
        })}
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
