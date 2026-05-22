"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowLeftIcon, MessageCircleIcon, SendIcon } from "lucide-react";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
import { EmptyState } from "@/components/atoms/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { intlLocale } from "@/lib/format";

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

interface Message {
  id: string;
  direction: "IN" | "OUT";
  body: string | null;
  status: string | null;
  createdAt: string;
  sender: { id: string; name: string | null } | null;
}

interface MessagesResponse {
  rows: Message[];
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

function fetchMessages(conversationId: string): Promise<MessagesResponse> {
  return fetch(
    `/api/crm/conversations/${conversationId}/messages?limit=50`,
    { credentials: "include" },
  ).then((r) => {
    if (!r.ok) throw new Error(`sms messages ${r.status}`);
    return r.json() as Promise<MessagesResponse>;
  });
}

export function SmsPageClient() {
  const t = useTranslations("smsInbox");
  const locale = useLocale();
  const dateLocale = intlLocale(locale);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const q = useQuery({
    queryKey: ["sms-conversations"],
    queryFn: fetchSmsConversations,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const rows = q.data?.rows ?? [];
  const selected = rows.find((r) => r.id === selectedId) ?? null;

  return (
    <PageContainer>
      <SectionHeader title={t("title")} subtitle={t("subtitle")} />

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
      ) : selected ? (
        <ConversationThread
          conversation={selected}
          onBack={() => setSelectedId(null)}
          dateLocale={dateLocale}
          onSent={() => {
            void qc.invalidateQueries({ queryKey: ["sms-conversations"] });
          }}
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-3 py-3 hover:bg-muted/40"
            >
              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="flex flex-1 items-center gap-3 text-left"
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
                    ? new Date(r.lastMessageAt).toLocaleString(dateLocale)
                    : "—"}
                </div>
              </button>
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

function ConversationThread({
  conversation,
  onBack,
  dateLocale,
  onSent,
}: {
  conversation: Conversation;
  onBack: () => void;
  dateLocale: string;
  onSent: () => void;
}) {
  const t = useTranslations("smsInbox");
  const qc = useQueryClient();
  const [draft, setDraft] = React.useState("");

  const msgs = useQuery({
    queryKey: ["sms-thread", conversation.id],
    queryFn: () => fetchMessages(conversation.id),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });

  const sendMut = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(
        `/api/crm/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ body: text }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `send ${res.status}`);
      }
      return data;
    },
    onSuccess: (data) => {
      setDraft("");
      void qc.invalidateQueries({ queryKey: ["sms-thread", conversation.id] });
      onSent();
      if (data.status === "FAILED") {
        toast.error(t("sendFailed"));
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Newest-first → reverse for chronological display.
  const messages = (msgs.data?.rows ?? []).slice().reverse();

  const onSend = () => {
    const text = draft.trim();
    if (!text) return;
    sendMut.mutate(text);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeftIcon className="size-4" />
            {t("back")}
          </Button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {conversation.patient?.fullName ??
                conversation.patient?.phone ??
                t("unknownSender")}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {conversation.patient?.phone ?? ""}
            </div>
          </div>
        </div>
      </div>

      <div className="flex max-h-[60vh] min-h-[40vh] flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-card p-3">
        {msgs.isLoading ? (
          <Skeleton className="h-12 w-2/3" />
        ) : messages.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {t("emptyThread")}
          </div>
        ) : (
          messages.map((m) => (
            <MessageBubble key={m.id} message={m} dateLocale={dateLocale} />
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("composerPlaceholder")}
          className="min-h-[64px] flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <Button
          onClick={onSend}
          disabled={!draft.trim() || sendMut.isPending}
          className="h-[64px]"
        >
          <SendIcon className="size-4" />
          {sendMut.isPending ? t("sending") : t("send")}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("composerHint")}</p>
    </div>
  );
}

function MessageBubble({
  message,
  dateLocale,
}: {
  message: Message;
  dateLocale: string;
}) {
  const isOut = message.direction === "OUT";
  const failed = message.status === "FAILED";
  return (
    <div className={cn("flex", isOut ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm",
          isOut
            ? failed
              ? "bg-destructive/15 text-destructive"
              : "bg-primary text-primary-foreground"
            : "bg-muted",
        )}
      >
        <div className="whitespace-pre-wrap break-words">{message.body ?? ""}</div>
        <div
          className={cn(
            "mt-1 text-[10px] tabular-nums",
            isOut
              ? failed
                ? "text-destructive/80"
                : "text-primary-foreground/70"
              : "text-muted-foreground",
          )}
        >
          {new Date(message.createdAt).toLocaleString(dateLocale)}
          {failed ? " · ⚠" : ""}
        </div>
      </div>
    </div>
  );
}
