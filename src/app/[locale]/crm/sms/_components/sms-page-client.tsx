"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { MessageCircleIcon } from "lucide-react";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { EmptyState } from "@/components/atoms/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

interface Conversation {
  id: string;
  channel: "SMS" | "TG" | string;
  status: string;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  patient: { id: string; fullName: string; phone: string | null } | null;
}

interface ListResponse {
  rows: Conversation[];
  nextCursor: string | null;
}

function fetchSmsConversations(): Promise<ListResponse> {
  return fetch("/api/crm/conversations?channel=SMS", {
    credentials: "include",
  }).then((r) => {
    if (!r.ok) throw new Error(`sms conversations ${r.status}`);
    return r.json() as Promise<ListResponse>;
  });
}

export function SmsPageClient() {
  const t = useTranslations("smsInbox");
  const locale = useLocale();

  const q = useQuery({
    queryKey: ["sms-conversations"],
    queryFn: fetchSmsConversations,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const rows = q.data?.rows ?? [];

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

      <p className="mb-3 rounded border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {t("mvpHint")}
      </p>

      {q.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<MessageCircleIcon />}
          title={t("empty")}
          description={t("mvpHint")}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted/40"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MessageCircleIcon className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {r.patient?.fullName ?? r.patient?.phone ?? "—"}
                  </span>
                  {r.unreadCount > 0 ? (
                    <span className="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-foreground">
                      {r.unreadCount}
                    </span>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {r.lastMessageText ?? ""}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {r.lastMessageAt
                  ? new Date(r.lastMessageAt).toLocaleString(
                      locale === "uz" ? "uz-UZ" : "ru-RU",
                    )
                  : "—"}
              </div>
              {r.patient ? (
                <Link
                  href={`/${locale}/crm/patients/${r.patient.id}`}
                  className="text-xs text-primary hover:underline"
                >
                  {t("openDetails")}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
