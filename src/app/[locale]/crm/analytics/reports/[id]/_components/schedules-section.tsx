"use client";

/**
 * Phase 18 Wave 4 — list / create / edit / delete / pause schedules for one
 * saved report. Lives below the result table on the saved-report view page.
 *
 * GET on mount + after every mutation. Optimism is a code-smell here because
 * the list is short (typically 1-3 rows per report) and the worker tick
 * matters more than UI snappiness.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/molecules/confirm-delete-dialog";
import { formatClinicDateTime, type Locale } from "@/lib/format";

import { cadenceLabel, type ScheduleCadence } from "@/server/analytics/cadence";

import {
  ScheduleFormDialog,
  type ScheduleFormValues,
} from "./schedule-form-dialog";

interface ScheduleRow {
  id: string;
  cadence: ScheduleCadence;
  deliveryChannel: "EMAIL" | "TELEGRAM";
  deliveryTarget: string;
  format: "pdf" | "csv";
  enabled: boolean;
  nextRunAt: string;
  lastDeliveredAt: string | null;
  lastFailureReason: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface SchedulesSectionProps {
  reportId: string;
  locale: "ru" | "uz";
}

function fmtDateTime(iso: string, locale: Locale): string {
  return formatClinicDateTime(iso, locale);
}

export function SchedulesSection({
  reportId,
  locale,
}: SchedulesSectionProps): React.JSX.Element {
  const t = useTranslations("analyticsReports.schedules");
  const [rows, setRows] = React.useState<ScheduleRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ScheduleRow | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(
    null,
  );
  const [deleting, setDeleting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/crm/analytics/reports/${reportId}/schedules`,
      );
      if (!r.ok) {
        toast.error(t("toastListFailed"));
        return;
      }
      const data: { rows: ScheduleRow[] } = await r.json();
      setRows(data.rows);
    } finally {
      setLoading(false);
    }
  }, [reportId, t]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async (values: ScheduleFormValues) => {
    const r = await fetch(
      `/api/crm/analytics/reports/${reportId}/schedules`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      },
    );
    if (!r.ok) {
      let key: "validation" | "fail" = "fail";
      try {
        const parsed = await r.json();
        if (
          r.status === 422 &&
          Array.isArray(parsed?.issues) &&
          parsed.issues.length > 0
        ) {
          key = "validation";
        }
      } catch {
        /* leave fallback */
      }
      toast.error(
        key === "validation"
          ? t("toastValidationFailed")
          : t("toastCreateFailed"),
      );
      return;
    }
    toast.success(t("toastCreated"));
    setCreateOpen(false);
    void refresh();
  };

  const onUpdate = async (id: string, patch: Partial<ScheduleFormValues>) => {
    const r = await fetch(
      `/api/crm/analytics/reports/${reportId}/schedules/${id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      },
    );
    if (!r.ok) {
      let key: "validation" | "fail" = "fail";
      try {
        const parsed = await r.json();
        if (
          r.status === 422 &&
          Array.isArray(parsed?.issues) &&
          parsed.issues.length > 0
        ) {
          key = "validation";
        }
      } catch {
        /* leave fallback */
      }
      toast.error(
        key === "validation"
          ? t("toastValidationFailed")
          : t("toastUpdateFailed"),
      );
      return;
    }
    toast.success(t("toastUpdated"));
    setEditing(null);
    void refresh();
  };

  const confirmDelete = async () => {
    const id = pendingDeleteId;
    if (!id) return;
    setDeleting(true);
    try {
      const r = await fetch(
        `/api/crm/analytics/reports/${reportId}/schedules/${id}`,
        { method: "DELETE" },
      );
      if (!r.ok) {
        toast.error(t("toastDeleteFailed"));
        return;
      }
      toast.success(t("toastDeleted"));
      void refresh();
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  };

  const onTogglePause = async (row: ScheduleRow) => {
    await onUpdate(row.id, { enabled: !row.enabled });
  };

  return (
    <section className="mt-8 rounded-md border">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{t("sectionTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("sectionSubtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          {t("newButton")}
        </Button>
      </header>

      {loading && rows === null ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : rows === null || rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
          {t("empty")}
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => {
            const failingHard = row.consecutiveFailures >= 3;
            return (
              <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {row.enabled ? (
                      <Badge variant="success">{t("statusEnabled")}</Badge>
                    ) : failingHard ? (
                      <Badge variant="destructive">{t("statusDisabledFailures")}</Badge>
                    ) : (
                      <Badge variant="muted">{t("statusDisabled")}</Badge>
                    )}
                    <span className="text-sm font-medium">
                      {cadenceLabel(row.cadence, locale)}
                    </span>
                    <Badge variant="outline">
                      {row.format === "pdf" ? t("formatPdf") : t("formatCsv")}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {row.deliveryChannel === "EMAIL" ? t("channelEmail") : t("channelTelegram")}
                    {" · "}
                    <span className="font-mono">{row.deliveryTarget}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("nextRunAt", { ts: fmtDateTime(row.nextRunAt, locale) })}
                    {row.lastDeliveredAt
                      ? ` · ${t("lastDeliveredAt", { ts: fmtDateTime(row.lastDeliveredAt, locale) })}`
                      : ""}
                  </div>
                  {row.lastFailureReason ? (
                    <div className="text-xs text-destructive">
                      {t("lastFailureReason", { reason: row.lastFailureReason })}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void onTogglePause(row)}
                  >
                    {row.enabled ? t("pause") : t("resume")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(row)}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setPendingDeleteId(row.id)}
                  >
                    {t("delete")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ScheduleFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        locale={locale}
        onSubmit={onCreate}
      />

      {editing ? (
        <ScheduleFormDialog
          open={editing !== null}
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          mode="edit"
          locale={locale}
          initial={{
            cadence: editing.cadence,
            deliveryChannel: editing.deliveryChannel,
            deliveryTarget: editing.deliveryTarget,
            format: editing.format,
            enabled: editing.enabled,
          }}
          onSubmit={(values) => onUpdate(editing.id, values)}
        />
      ) : null}

      <ConfirmDeleteDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title={t("confirmDelete")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        onConfirm={confirmDelete}
        pending={deleting}
      />
    </section>
  );
}
