"use client";

/**
 * View one saved report — auto-runs on mount, shows the result table with
 * Edit / Delete / Export-CSV toolbar. Scheduling is W4's job — no stub.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { filenameFromContentDisposition } from "@/lib/content-disposition";
import { formatClinicDateTime } from "@/lib/format";
import {
  formatReportCell,
  type ReportCellUnit,
} from "@/lib/analytics/report-cells";

import type { ReportConfig } from "@/server/analytics/report-config";

import { SchedulesSection } from "./schedules-section";

interface ReportColumnDescriptor {
  key: string;
  /** Localized on the server (report-runner.ts). */
  label: string;
  kind: "dimension" | "measure";
  unit?: ReportCellUnit;
}

interface ReportRunResponse {
  rows: Array<Record<string, unknown>>;
  columns: ReportColumnDescriptor[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
}

export interface ReportViewClientProps {
  locale: "ru" | "uz";
  report: {
    id: string;
    name: string;
    description: string | null;
    config: ReportConfig;
    lastRunAt: string | null;
  };
}

export function ReportViewClient({
  locale,
  report,
}: ReportViewClientProps): React.JSX.Element {
  const t = useTranslations("analyticsReports.view");
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [result, setResult] = React.useState<ReportRunResponse | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const run = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/crm/analytics/reports/${report.id}/run?locale=${locale}`,
        { method: "POST" },
      );
      if (!r.ok) {
        let msg = t("toastRunFailed");
        try {
          const parsed = await r.json();
          if (parsed?.error === "ReportTimeout") msg = t("toastRunTimeout");
        } catch {
          // leave default
        }
        toast.error(msg);
        return;
      }
      const data: ReportRunResponse = await r.json();
      setResult(data);
    } finally {
      setLoading(false);
    }
  }, [report.id, locale, t]);

  React.useEffect(() => {
    void run();
  }, [run]);

  const onExport = async (fmt: "csv" | "pdf") => {
    const r = await fetch(
      `/api/crm/analytics/reports/${report.id}/run?format=${fmt}&locale=${locale}`,
      { method: "POST" },
    );
    if (!r.ok) {
      toast.error(fmt === "pdf" ? t("toastExportPdfFailed") : t("toastExportFailed"));
      return;
    }
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    // The UTF-8 `filename*` carries a Cyrillic report name (audit AN-26).
    a.download = filenameFromContentDisposition(
      r.headers.get("content-disposition"),
      `report.${fmt}`,
    );
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const r = await fetch(`/api/crm/analytics/reports/${report.id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        toast.error(t("toastDeleteFailed"));
        return;
      }
      toast.success(t("toastDeleted"));
      router.push(`/${locale}/crm/analytics/reports`);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <PageContainer>
      <SectionHeader
        title={report.name}
        subtitle={report.description ?? undefined}
        actions={
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void run()} disabled={loading}>
              {loading ? t("rerunning") : t("rerun")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void onExport("csv")}
              disabled={!result}
            >
              {t("exportCsv")}
            </Button>
            <Button
              variant="outline"
              onClick={() => void onExport("pdf")}
              disabled={!result}
            >
              {t("exportPdf")}
            </Button>
            <Button
              variant="outline"
              render={
                <Link href={`/${locale}/crm/analytics/reports/${report.id}/edit`} />
              }
            >
              {t("edit")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={deleting}
            >
              {t("delete")}
            </Button>
          </span>
        }
      />

      {loading && !result ? (
        <div className="mt-6 rounded-md border px-4 py-12 text-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : null}

      <SchedulesSection reportId={report.id} locale={locale} />

      <ConfirmDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={deleting}
      />

      {result ? (
        <section className="mt-6 rounded-md border">
          <div className="flex items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
            <span>
              {t("rowCount", { count: result.rowCount })}
              {result.truncated ? ` · ${t("truncated")}` : ""}
            </span>
            <span>
              {t("generatedAt", {
                ts: formatClinicDateTime(result.generatedAt, locale),
              })}
            </span>
          </div>
          {result.rowCount === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t("empty")}
            </div>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted text-xs">
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c.key}
                        className="border-b px-3 py-2 text-left font-medium"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0">
                      {result.columns.map((c) => (
                        <td
                          key={c.key}
                          className={
                            c.kind === "measure"
                              ? "px-3 py-1.5 text-right tabular-nums"
                              : "px-3 py-1.5"
                          }
                        >
                          {formatReportCell(row[c.key], c.unit, locale)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </PageContainer>
  );
}
