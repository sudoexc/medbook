"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  DownloadIcon,
  FileTextIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";

import { useDocumentsFilters } from "../_hooks/documents-context";
import {
  flattenDoctorDocuments,
  useDoctorDocuments,
  type DocumentType,
  type DoctorDocumentRow,
} from "../_hooks/use-doctor-documents";

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

function ruDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const day = d.getDate();
  const month = RU_MONTHS_SHORT[d.getMonth()] ?? "";
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { date: `${day} ${month} ${year}`, time: `${hh}:${mm}` };
}

function formatSize(
  bytes: number | null,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return t("size.bytes", { n: bytes });
  if (bytes < 1024 * 1024) return t("size.kb", { n: (bytes / 1024).toFixed(1) });
  if (bytes < 1024 * 1024 * 1024)
    return t("size.mb", { n: (bytes / (1024 * 1024)).toFixed(1) });
  return t("size.gb", { n: (bytes / (1024 * 1024 * 1024)).toFixed(1) });
}

const TYPE_LABEL_KEY: Record<DocumentType, string> = {
  REFERRAL: "type.referral",
  PRESCRIPTION: "type.prescription",
  RESULT: "type.result",
  CONSENT: "type.consent",
  CONTRACT: "type.contract",
  RECEIPT: "type.receipt",
  OTHER: "type.other",
};

const TYPE_TONE: Record<DocumentType, string> = {
  REFERRAL: "bg-info/15 text-info",
  PRESCRIPTION: "bg-primary/15 text-primary",
  RESULT: "bg-success/15 text-success",
  CONSENT: "bg-warning/15 text-warning",
  CONTRACT: "bg-warning/15 text-warning",
  RECEIPT: "bg-muted text-muted-foreground",
  OTHER: "bg-muted text-muted-foreground",
};

const GRID =
  "grid grid-cols-[minmax(0,1.7fr)_minmax(0,1.2fr)_130px_140px_90px_44px] gap-3";

export function DocumentsTable() {
  const t = useTranslations("doctor.documents");
  const { filters } = useDocumentsFilters();
  const query = useDoctorDocuments(filters);
  const rows = flattenDoctorDocuments(query.data);

  const isInitialLoading = query.isLoading;
  const isEmpty = !isInitialLoading && rows.length === 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div
        className={cn(
          GRID,
          "items-center border-b border-border bg-muted/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
        )}
      >
        <div>{t("table.colTitle")}</div>
        <div>{t("table.colPatient")}</div>
        <div>{t("table.colType")}</div>
        <div>{t("table.colDate")}</div>
        <div>{t("table.colSize")}</div>
        <div className="text-right">…</div>
      </div>

      {isInitialLoading ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {t("table.loading")}
        </div>
      ) : query.isError ? (
        <div className="px-5 py-10 text-center text-sm text-destructive">
          {t("table.error")}
        </div>
      ) : isEmpty ? (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          {filters.q || filters.type
            ? t("table.emptyFiltered")
            : t("table.empty")}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <DocumentRow key={r.id} doc={r} />
            ))}
          </ul>

          {query.hasNextPage ? (
            <div className="border-t border-border px-5 py-3 text-center">
              <button
                type="button"
                onClick={() => query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {query.isFetchingNextPage
                  ? t("table.loadingMore")
                  : t("table.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function DocumentRow({ doc }: { doc: DoctorDocumentRow }) {
  const t = useTranslations("doctor.documents");
  const { filters } = useDocumentsFilters();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const { date, time } = ruDate(doc.createdAt);

  const handleDelete = async () => {
    if (busy) return;
    if (!confirm(t("row.deleteConfirm", { title: doc.title }))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/documents/${doc.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const txt = await res.text();
        alert(t("row.deleteError", { detail: txt || res.status }));
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: ["doctor", "me", "documents", filters],
      });
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const handleDownload = () => {
    setMenuOpen(false);
    if (doc.fileUrl) window.open(doc.fileUrl, "_blank", "noopener");
  };

  return (
    <li
      className={cn(GRID, "items-center px-5 py-3.5 transition-colors hover:bg-muted/30")}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
          <FileTextIcon className="size-4 text-destructive" />
        </span>
        <a
          href={doc.fileUrl || "#"}
          target="_blank"
          rel="noopener"
          className="truncate text-sm font-medium text-foreground hover:underline"
          title={doc.title}
        >
          {doc.title}
        </a>
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">
          {doc.patient?.fullName ?? "—"}
        </div>
        {doc.uploadedBy ? (
          <div className="truncate text-xs text-muted-foreground">
            {t("row.uploadedBy", { name: doc.uploadedBy.name })}
          </div>
        ) : null}
      </div>

      <div>
        <span
          className={cn(
            "inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold",
            TYPE_TONE[doc.type],
          )}
        >
          {t(TYPE_LABEL_KEY[doc.type])}
        </span>
      </div>

      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground tabular-nums">
          {date}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">{time}</div>
      </div>

      <div className="text-sm text-foreground tabular-nums">
        {formatSize(doc.sizeBytes, t)}
      </div>

      <div className="relative flex justify-end">
        <button
          type="button"
          aria-label={t("row.moreActions")}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MoreHorizontalIcon className="size-4" />
        </button>
        {menuOpen ? (
          <>
            <button
              type="button"
              aria-label={t("row.closeMenu")}
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute right-0 top-9 z-20 min-w-[180px] overflow-hidden rounded-lg border border-border bg-popover py-1 text-sm shadow-md">
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-foreground transition-colors hover:bg-muted"
              >
                <DownloadIcon className="size-4 text-muted-foreground" />
                {t("row.download")}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={busy}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
              >
                <Trash2Icon className="size-4" />
                {busy ? t("row.deleting") : t("row.delete")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </li>
  );
}
