"use client";

/**
 * Phase 17 Wave 3 — DSAR review queue client.
 *
 * Two tabs (export / deletion). Each tab uses react-query for the list,
 * and per-row mutations for the action buttons (download / approve /
 * cancel). All endpoints are ADMIN-only on the server side; we additionally
 * gate the cancel/approve buttons by status to keep the UI honest.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { settingsFetch } from "../../_hooks/use-settings-api";

type Tab = "exports" | "deletions";

type ExportRow = {
  id: string;
  status:
    | "PENDING"
    | "PROCESSING"
    | "READY"
    | "DELIVERED"
    | "FAILED"
    | "EXPIRED";
  patientId: string;
  patientName: string | null;
  fileSizeBytes: number | null;
  downloadCount: number;
  expiresAt: string;
  errorMessage: string | null;
  createdAt: string;
  requestedByUserId: string | null;
};

type DeletionRow = {
  id: string;
  status:
    | "PENDING_REVIEW"
    | "APPROVED"
    | "CANCELLED"
    | "EXECUTED"
    | "ANONYMIZED";
  mode: "ANONYMIZE" | "HARD_DELETE";
  patientId: string;
  patientName: string | null;
  scheduledFor: string;
  executedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  approvedByUserId: string | null;
  cancelledByUserId: string | null;
  requestedByUserId: string | null;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(n: number | null): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function DsarReviewClient() {
  const t = useTranslations("settings.dsar");
  const [tab, setTab] = React.useState<Tab>("deletions");

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex gap-2">
        <Button
          variant={tab === "deletions" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("deletions")}
        >
          {t("tabs.deletions")}
        </Button>
        <Button
          variant={tab === "exports" ? "default" : "ghost"}
          size="sm"
          onClick={() => setTab("exports")}
        >
          {t("tabs.exports")}
        </Button>
      </div>

      {tab === "exports" ? <ExportsTab /> : <DeletionsTab />}
    </PageContainer>
  );
}

// ─── Exports tab ──────────────────────────────────────────────────────────

function ExportsTab() {
  const t = useTranslations("settings.dsar");
  const query = useQuery<{ items: ExportRow[] }>({
    queryKey: ["crm", "dsar", "exports"],
    queryFn: async () => settingsFetch("/api/crm/dsar/exports"),
  });

  const downloadMut = useMutation<{ url: string }, Error, string>({
    mutationFn: async (id) =>
      settingsFetch(`/api/crm/dsar/exports/${encodeURIComponent(id)}/download`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      if (data.url) {
        window.open(data.url, "_blank", "noopener");
      }
    },
    onError: () => toast.error(t("downloadError")),
  });

  const rows = query.data?.items ?? [];

  if (query.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        {t("loadMore")}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="motion-stagger space-y-2">
      {rows.map((r) => {
        const canDownload = r.status === "READY" || r.status === "DELIVERED";
        return (
          <div
            key={r.id}
            className="motion-rise-in flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <ExportStatusBadge status={r.status} />
                <span className="text-sm font-medium text-foreground">
                  {r.patientName ?? t("patientUnknown")}
                </span>
                <span className="text-xs text-muted-foreground">
                  · {formatDate(r.createdAt)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {t("fileSize", { size: formatBytes(r.fileSizeBytes) })} ·{" "}
                {t("downloadCount", { n: r.downloadCount })} ·{" "}
                {t("expiresAt")}: {formatDate(r.expiresAt)}
              </div>
              {r.errorMessage ? (
                <div className="text-xs text-destructive">
                  {t("errorMessage")}: {r.errorMessage}
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canDownload || downloadMut.isPending}
                onClick={() => downloadMut.mutate(r.id)}
              >
                <DownloadIcon className="size-4" />
                {t("actions.download")}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExportStatusBadge({ status }: { status: ExportRow["status"] }) {
  const t = useTranslations("settings.dsar.exportStatus");
  const variantMap: Record<ExportRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
    PENDING: "secondary",
    PROCESSING: "secondary",
    READY: "default",
    DELIVERED: "default",
    FAILED: "destructive",
    EXPIRED: "outline",
  };
  const Icon = {
    PENDING: ClockIcon,
    PROCESSING: ClockIcon,
    READY: CheckCircle2Icon,
    DELIVERED: CheckCircle2Icon,
    FAILED: AlertCircleIcon,
    EXPIRED: XCircleIcon,
  }[status];
  return (
    <Badge variant={variantMap[status]} className="gap-1">
      <Icon className="size-3" />
      {t(status)}
    </Badge>
  );
}

// ─── Deletions tab ────────────────────────────────────────────────────────

function DeletionsTab() {
  const t = useTranslations("settings.dsar");
  const qc = useQueryClient();
  const query = useQuery<{ items: DeletionRow[] }>({
    queryKey: ["crm", "dsar", "deletions"],
    queryFn: async () => settingsFetch("/api/crm/dsar/deletions"),
  });

  const approveMut = useMutation<unknown, Error, string>({
    mutationFn: async (id) =>
      settingsFetch(`/api/crm/dsar/deletions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      }),
    onSuccess: () => {
      toast.success(t("approveSuccess"));
      qc.invalidateQueries({ queryKey: ["crm", "dsar", "deletions"] });
    },
    onError: () => toast.error(t("approveError")),
  });

  const cancelMut = useMutation<unknown, Error, string>({
    mutationFn: async (id) =>
      settingsFetch(`/api/crm/dsar/deletions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      }),
    onSuccess: () => {
      toast.success(t("cancelSuccess"));
      qc.invalidateQueries({ queryKey: ["crm", "dsar", "deletions"] });
    },
    onError: () => toast.error(t("cancelError")),
  });

  const rows = query.data?.items ?? [];
  // Sort: PENDING_REVIEW first, then APPROVED, then everything else by
  // createdAt desc (server already returns desc).
  const sortedRows = React.useMemo(() => {
    const order: Record<DeletionRow["status"], number> = {
      PENDING_REVIEW: 0,
      APPROVED: 1,
      EXECUTED: 2,
      ANONYMIZED: 2,
      CANCELLED: 3,
    };
    return [...rows].sort((a, b) => order[a.status] - order[b.status]);
  }, [rows]);

  if (query.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">{t("loadMore")}</div>
    );
  }
  if (sortedRows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {t("empty")}
      </div>
    );
  }

  return (
    <div className="motion-stagger space-y-2">
      {sortedRows.map((r) => (
        <DeletionRowCard
          key={r.id}
          row={r}
          onApprove={() => approveMut.mutate(r.id)}
          onCancel={() => {
            if (confirm(t("actions.confirmCancel"))) {
              cancelMut.mutate(r.id);
            }
          }}
          approving={approveMut.isPending}
          cancelling={cancelMut.isPending}
        />
      ))}
    </div>
  );
}

function DeletionRowCard({
  row,
  onApprove,
  onCancel,
  approving,
  cancelling,
}: {
  row: DeletionRow;
  onApprove: () => void;
  onCancel: () => void;
  approving: boolean;
  cancelling: boolean;
}) {
  const t = useTranslations("settings.dsar");
  const canApprove = row.status === "PENDING_REVIEW";
  const canCancel = row.status === "PENDING_REVIEW" || row.status === "APPROVED";
  return (
    <div className="motion-rise-in flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <DeletionStatusBadge status={row.status} />
          <Badge variant="outline" className="gap-1">
            <ShieldCheckIcon className="size-3" />
            {t(`mode.${row.mode}`)}
          </Badge>
          <span className="text-sm font-medium text-foreground">
            {row.patientName ?? t("patientUnknown")}
          </span>
          <span className="text-xs text-muted-foreground">
            · {formatDate(row.createdAt)}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          {t("scheduledFor")}: {formatDate(row.scheduledFor)}
          {row.executedAt
            ? ` · ${t("executedAt")}: ${formatDate(row.executedAt)}`
            : null}
          {row.cancelledAt
            ? ` · ${t("cancelledAt")}: ${formatDate(row.cancelledAt)}`
            : null}
        </div>
        {row.reason ? (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{t("reason")}:</span> {row.reason}
          </div>
        ) : null}
        {row.notes ? (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">{t("notes")}:</span> {row.notes}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 gap-2">
        {canApprove ? (
          <Button
            size="sm"
            variant="default"
            disabled={approving}
            onClick={onApprove}
          >
            {approving ? t("actions.approving") : t("actions.approve")}
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="outline"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? t("actions.cancelling") : t("actions.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DeletionStatusBadge({ status }: { status: DeletionRow["status"] }) {
  const t = useTranslations("settings.dsar.deletionStatus");
  const variantMap: Record<DeletionRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
    PENDING_REVIEW: "secondary",
    APPROVED: "default",
    CANCELLED: "outline",
    EXECUTED: "destructive",
    ANONYMIZED: "outline",
  };
  const Icon = {
    PENDING_REVIEW: ClockIcon,
    APPROVED: CheckCircle2Icon,
    CANCELLED: XCircleIcon,
    EXECUTED: AlertCircleIcon,
    ANONYMIZED: ShieldCheckIcon,
  }[status];
  return (
    <Badge variant={variantMap[status]} className="gap-1">
      <Icon className="size-3" />
      {t(status)}
    </Badge>
  );
}
