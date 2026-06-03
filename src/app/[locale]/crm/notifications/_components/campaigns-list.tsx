"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { MegaphoneIcon, PlusIcon, RefreshCwIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";
import { cn } from "@/lib/utils";

import { useCampaigns, type CampaignRow } from "../_hooks/use-campaigns";

type Props = {
  // Kept for backwards compatibility with the templates page; not needed here.
  templates?: unknown;
};

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted/60 text-muted-foreground",
  SENDING: "bg-info/10 text-info",
  DONE: "bg-success/10 text-success",
  FAILED: "bg-destructive/10 text-destructive",
};

function formatBucket(row: CampaignRow): string | null {
  const seg = row.segment;
  if (!seg) return null;
  if (seg.kind === "dormant") return seg.bucket;
  return null;
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale === "uz" ? "uz-UZ" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CampaignsList(_props: Props) {
  const t = useTranslations("notifications.campaigns");
  const locale = useLocale();
  const { data, isLoading, refetch, isFetching } = useCampaigns({ limit: 50 });
  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t("title")}</h3>
          <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label={t("refresh")}
          >
            <RefreshCwIcon className={cn("size-4", isFetching && "animate-spin")} />
          </Button>
          <Link
            href={`/${locale}/crm/notifications/campaigns/new`}
            className={cn(buttonVariants({ variant: "default" }))}
          >
            <PlusIcon className="size-4" />
            {t("new")}
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MegaphoneIcon />}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-[32%] px-3 py-2 text-left font-medium">
                  {t("col.name")}
                </th>
                <th className="w-[12%] px-3 py-2 text-left font-medium">
                  {t("col.segment")}
                </th>
                <th className="w-[10%] px-3 py-2 text-left font-medium">
                  {t("col.channel")}
                </th>
                <th className="w-[14%] px-3 py-2 text-left font-medium">
                  {t("col.status")}
                </th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">
                  {t("col.sent")}
                </th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">
                  {t("col.total")}
                </th>
                <th className="w-[12%] px-3 py-2 text-left font-medium">
                  {t("col.startedAt")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const bucket = formatBucket(row);
                return (
                  <tr
                    key={row.id}
                    className="border-t border-border last:border-b-0"
                  >
                    <td className="truncate px-3 py-2 text-foreground">
                      <div className="truncate font-medium">{row.name}</div>
                      {row.template ? (
                        <div className="truncate text-[11px] text-muted-foreground">
                          {locale === "uz"
                            ? row.template.nameUz
                            : row.template.nameRu}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {bucket ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.channel}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                          STATUS_TONE[row.status] ??
                            "bg-muted/60 text-muted-foreground",
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.sentCount}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.totalCount}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {formatDate(row.startedAt ?? row.createdAt, locale)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
