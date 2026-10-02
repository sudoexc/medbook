"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheckIcon,
  BanIcon,
  DownloadIcon,
  EyeIcon,
  PenLineIcon,
  UploadIcon,
} from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { intlLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  DEFAULT_FILTERS,
  flattenDocs,
  useDocumentsList,
  type DocumentFilters,
  type DocumentFilterType,
} from "../_hooks/use-documents";
import { UploadDialog } from "./upload-dialog";
import { documentHref } from "@/lib/storage-ref";
import {
  canMarkSigned,
  isPatientDocument,
  isVoidedDocument,
  type DocumentSourceValue,
} from "@/lib/document-guards";

// The filter also offers conclusions (audit CD-17): never uploaded here,
// but the most common document in a chart.
const DOC_TYPES: DocumentFilterType[] = [
  "CONCLUSION",
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
];

// CD-06: filter by who put the document in the chart.
const SOURCE_LABEL_KEY: Record<DocumentSourceValue, string> = {
  STAFF: "filters.sourceStaff",
  PATIENT: "filters.sourcePatient",
  SYSTEM: "filters.sourceSystem",
};

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPageClient() {
  const t = useTranslations("docsLibrary");
  const locale = useLocale();
  const searchParams = useSearchParams();

  const initialPatientId = searchParams?.get("patientId") ?? "";
  const [filters, setFilters] = React.useState<DocumentFilters>(() => ({
    ...DEFAULT_FILTERS,
    patientId: initialPatientId,
  }));
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const q = useDocumentsList(filters);
  const rows = flattenDocs(q.data?.pages);
  const qc = useQueryClient();

  const sign = useMutation<unknown, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(`/api/crm/documents/${id}/sign`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`sign ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(t("signedToast"));
      void qc.invalidateQueries({ queryKey: ["documents", "list"] });
    },
    onError: () => toast.error(t("signError")),
  });

  const patch = (p: Partial<DocumentFilters>) =>
    setFilters((f) => ({ ...f, ...p }));

  return (
    <PageContainer>
      <SectionHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <UploadIcon />
            {t("upload")}
          </Button>
        }
      />

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <Input
            value={filters.q}
            onChange={(e) => patch({ q: e.target.value })}
            placeholder={t("filters.search")}
            aria-label={t("filters.search")}
          />
        </div>
        <Select
          value={filters.type || "__all"}
          onValueChange={(v) =>
            patch({ type: v === "__all" ? "" : (v as DocumentFilterType) })
          }
        >
          {/* aria-label: no visible <label> for this filter, and a closed
              Radix Select exposes no inner text to the accessibility tree —
              without an explicit name axe flags `button-name` (critical). */}
          <SelectTrigger className="w-[180px]" aria-label={t("filters.type")}>
            <SelectValue placeholder={t("filters.type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("filters.typeAll")}</SelectItem>
            {DOC_TYPES.map((tp) => (
              <SelectItem key={tp} value={tp}>
                {t(`types.${tp}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.source || "__all"}
          onValueChange={(v) =>
            patch({ source: v === "__all" ? "" : (v as DocumentSourceValue) })
          }
        >
          <SelectTrigger className="w-[190px]" aria-label={t("filters.source")}>
            <SelectValue placeholder={t("filters.source")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">{t("filters.sourceAll")}</SelectItem>
            {(Object.keys(SOURCE_LABEL_KEY) as DocumentSourceValue[]).map((src) => (
              <SelectItem key={src} value={src}>
                {t(SOURCE_LABEL_KEY[src] as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={filters.from}
            onChange={(e) => patch({ from: e.target.value })}
            placeholder={t("filters.from")}
            className="w-[150px]"
            aria-label={t("filters.from")}
          />
          <span className="text-xs text-muted-foreground">—</span>
          <Input
            type="date"
            value={filters.to}
            onChange={(e) => patch({ to: e.target.value })}
            placeholder={t("filters.to")}
            className="w-[150px]"
            aria-label={t("filters.to")}
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={filters.pendingSignature}
            onChange={(e) => patch({ pendingSignature: e.target.checked })}
          />
          {t("pendingSignatures")}
        </label>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setFilters(DEFAULT_FILTERS)}
        >
          {t("filters.reset")}
        </Button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-border bg-muted/30 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("columns.title")}</th>
              <th className="px-3 py-2 font-medium">{t("columns.patient")}</th>
              <th className="px-3 py-2 font-medium">{t("columns.doctor")}</th>
              <th className="px-3 py-2 font-medium">{t("columns.type")}</th>
              <th className="px-3 py-2 font-medium">{t("columns.uploadedAt")}</th>
              <th className="px-3 py-2 font-medium">{t("columns.size")}</th>
              <th className="px-3 py-2 text-right font-medium">
                {t("columns.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                  <td colSpan={7} className="px-3 py-2">
                    <Skeleton className="h-5 w-full" />
                  </td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  {t("empty")}
                </td>
              </tr>
            ) : (
              rows.map((d) => {
                const doctorName =
                  d.appointment?.doctor &&
                  (locale === "uz" && d.appointment.doctor.nameUz
                    ? d.appointment.doctor.nameUz
                    : d.appointment.doctor.nameRu);
                return (
                  <tr
                    key={d.id}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-3 py-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{d.title}</span>
                        {/* CD-06: by the stored source; rendered
                            conclusions used to carry this badge too. */}
                        {isPatientDocument(d) ? (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            {t("patientUploadBadge")}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {d.patient ? (
                        <Link
                          href={`/${locale}/crm/patients/${d.patient.id}`}
                          className="text-primary hover:underline"
                        >
                          {d.patient.fullName}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {doctorName ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs">
                        {t(`types.${d.type}` as never)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString(intlLocale(locale))}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatSize(d.sizeBytes)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* CD-09: voided by ADMIN, kept as a record. */}
                      {isVoidedDocument(d) ? (
                        <span
                          title={d.voidReason ?? undefined}
                          className="mr-1 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive"
                        >
                          <BanIcon className="size-3" />
                          {t("voided")}
                        </span>
                      ) : d.signedAt || canMarkSigned(d) ? (
                        d.signedAt ? (
                          <span
                            title={new Date(d.signedAt).toLocaleString(
                              intlLocale(locale),
                            )}
                            className="mr-1 inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                          >
                            <BadgeCheckIcon className="size-3" />
                            {t("signed")}
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mr-1"
                            disabled={sign.isPending}
                            onClick={() => sign.mutate(d.id)}
                          >
                            <PenLineIcon className="mr-1 size-3.5" />
                            {t("actions.markSigned")}
                          </Button>
                        )
                      ) : null}
                      <a
                        href={documentHref(d.fileUrl) ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon-sm" }),
                          "mr-1",
                        )}
                        aria-label={t("actions.view")}
                      >
                        <EyeIcon />
                      </a>
                      <a
                        href={documentHref(d.fileUrl, { download: true }) ?? "#"}
                        download
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon-sm" }),
                        )}
                        aria-label={t("actions.download")}
                      >
                        <DownloadIcon />
                      </a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {q.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? "…" : "+"}
          </Button>
        </div>
      ) : null}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        initialPatientId={filters.patientId || undefined}
        onUploaded={() => {
          setUploadOpen(false);
          void q.refetch();
        }}
      />
    </PageContainer>
  );
}
