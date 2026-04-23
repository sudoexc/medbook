"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { DownloadIcon, EyeIcon, UploadIcon } from "lucide-react";

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
import { cn } from "@/lib/utils";

import {
  DEFAULT_FILTERS,
  flattenDocs,
  useDocumentsList,
  type DocumentFilters,
  type DocumentType,
} from "../_hooks/use-documents";
import { UploadDialog } from "./upload-dialog";

const DOC_TYPES: DocumentType[] = [
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
];

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPageClient() {
  const t = useTranslations("docsLibrary");
  const locale = useLocale();

  const [filters, setFilters] = React.useState<DocumentFilters>(DEFAULT_FILTERS);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const q = useDocumentsList(filters);
  const rows = flattenDocs(q.data?.pages);

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
            patch({ type: v === "__all" ? "" : (v as DocumentType) })
          }
        >
          <SelectTrigger className="w-[180px]">
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
      <div className="rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
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
                    <td className="px-3 py-2 font-medium">{d.title}</td>
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
                      {new Date(d.createdAt).toLocaleString(
                        locale === "uz" ? "uz-UZ" : "ru-RU",
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatSize(d.sizeBytes)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={d.fileUrl}
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
                        href={d.fileUrl}
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
        onUploaded={() => {
          setUploadOpen(false);
          void q.refetch();
        }}
      />
    </PageContainer>
  );
}
