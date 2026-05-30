"use client";

/**
 * Saved-reports list — Phase 18 Wave 3.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { formatClinicDateTime, type Locale } from "@/lib/format";

import type { SavedReportListResponse } from "@/server/analytics/saved-reports";

export interface ReportsListClientProps {
  locale: "ru" | "uz";
  initial: SavedReportListResponse;
}

export function ReportsListClient({
  locale,
  initial,
}: ReportsListClientProps): React.JSX.Element {
  const t = useTranslations("analyticsReports.list");
  const router = useRouter();
  const [data, setData] = React.useState(initial);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );

  const refresh = async (page: number) => {
    const r = await fetch(
      `/api/crm/analytics/reports?page=${page}&pageSize=${data.pagination.pageSize}`,
      { cache: "no-store" },
    );
    if (r.ok) {
      const next: SavedReportListResponse = await r.json();
      setData(next);
    }
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setBusyId(id);
    try {
      const r = await fetch(`/api/crm/analytics/reports/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        toast.error(t("toastDeleteFailed"));
        return;
      }
      toast.success(t("toastDeleted"));
      await refresh(data.pagination.page);
    } finally {
      setBusyId(null);
      setPendingDeleteId(null);
    }
  };

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button render={<Link href={`/${locale}/crm/analytics/reports/new`} />}>
            {t("newButton")}
          </Button>
        }
      />

      {data.rows.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button render={<Link href={`/${locale}/crm/analytics/reports/new`} />}>
              {t("newButton")}
            </Button>
          }
        />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t("colName")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("colDescription")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("colShape")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("colCreatedBy")}
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  {t("colLastRun")}
                </th>
                <th className="px-3 py-2 text-right font-medium">
                  {t("colActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">
                    <Link
                      href={`/${locale}/crm/analytics/reports/${r.id}`}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.description ?? ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {t("shape", {
                      dims: r.dimensionsCount,
                      measures: r.measuresCount,
                    })}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.createdByLabel ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.lastRunAt
                      ? formatClinicDateTime(r.lastRunAt, locale as Locale)
                      : t("neverRun")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span className="inline-flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link href={`/${locale}/crm/analytics/reports/${r.id}`} />
                        }
                      >
                        {t("actView")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        render={
                          <Link
                            href={`/${locale}/crm/analytics/reports/${r.id}/edit`}
                          />
                        }
                      >
                        {t("actEdit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === r.id}
                        onClick={() => setPendingDeleteId(r.id)}
                      >
                        {t("actDelete")}
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pagination.totalPages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {t("pageMeta", {
              page: data.pagination.page,
              total: data.pagination.totalPages,
            })}
          </span>
          <span className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={data.pagination.page <= 1}
              onClick={() => refresh(data.pagination.page - 1)}
            >
              {t("prev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={data.pagination.page >= data.pagination.totalPages}
              onClick={() => refresh(data.pagination.page + 1)}
            >
              {t("next")}
            </Button>
          </span>
        </nav>
      ) : null}

      <noscript>
        {/* router.refresh fallback for environments without sonner toasts */}
        <button onClick={() => router.refresh()} />
      </noscript>

      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("confirmDelete")}
        confirmLabel={t("actDelete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={busyId !== null}
      />
    </PageContainer>
  );
}
