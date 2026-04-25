"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarPlusIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileUpIcon,
  HistoryIcon,
  Loader2Icon,
  MessageSquareIcon,
  PhoneIcon,
  SparklesIcon,
  UserIcon,
  UserPlusIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { PhoneText } from "@/components/atoms/phone-text";
import { MoneyText } from "@/components/atoms/money-text";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import type { InboxConversation } from "../_hooks/types";
import { conversationsKey } from "../_hooks/use-conversations";
import { flattenMessages, useTgMessages } from "../_hooks/use-tg-messages";

export interface ChatRightRailProps {
  conversation: InboxConversation | null;
}

type PatientDetails = {
  id: string;
  fullName: string;
  phone: string;
  photoUrl: string | null;
  segment: string | null;
  balance: number | bigint | null;
  lifetimeSpend: number | bigint | null;
  lastVisitAt: string | null;
};

/**
 * Right rail on the Telegram inbox — see docs/7 - Telegram .png.
 *
 * Five stacked cards when a linked patient is selected:
 *  1. Patient mini (avatar + name + phone + primary CTAs)
 *  2. Quick-action tile grid (call, SMS, book, task, file, note)
 *  3. AI hints (placeholder until the AI service ships)
 *  4. Conversation history preview (last 4 messages)
 *  5. Telegram stats (in / out / unread / last activity)
 *
 * When the conversation lacks a `patientId` we render the compact "create
 * patient" mini-form from earlier (operator flow is: attach → rail changes).
 */
export function ChatRightRail({ conversation }: ChatRightRailProps) {
  const t = useTranslations("tgInbox.rail");

  if (!conversation) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <EmptyState
          icon={<UserIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }

  if (!conversation.patientId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
        <CreatePatientForm conversation={conversation} />
      </div>
    );
  }

  return <LinkedPatientRail conversation={conversation} />;
}

function LinkedPatientRail({ conversation }: { conversation: InboxConversation }) {
  const t = useTranslations("tgInbox.rail");
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const detailsQuery = useQuery<PatientDetails>({
    queryKey: ["patient-mini", conversation.patientId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/crm/patients/${conversation.patientId}`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as PatientDetails;
    },
    enabled: Boolean(conversation.patientId),
    staleTime: 30_000,
  });

  const messagesQuery = useTgMessages(conversation.id);
  const messages = React.useMemo(
    () => flattenMessages(messagesQuery.data?.pages),
    [messagesQuery.data],
  );

  const p = detailsQuery.data;
  const displayName =
    p?.fullName ?? conversation.patient?.fullName ?? t("anonymous");
  const phone = p?.phone ?? conversation.patient?.phone ?? null;
  const photo = p?.photoUrl ?? conversation.patient?.photoUrl ?? null;
  const patientId = conversation.patientId!;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <PatientHeaderCard
        name={displayName}
        photoUrl={photo}
        phone={phone}
        segment={p?.segment ?? null}
        balance={p?.balance ?? 0}
        lifetimeSpend={p?.lifetimeSpend ?? 0}
        isLoading={detailsQuery.isLoading}
        onBook={() => setDialogOpen(true)}
        openPatientHref={`/${locale}/crm/patients/${patientId}`}
        openPatientLabel={t("openPatient")}
        bookLabel={t("newAppointment")}
        segmentLabel={t("segment")}
        balanceLabel={t("balance")}
        lifetimeSpendLabel={t("lifetimeSpend")}
      />

      <ActionTileGrid phone={phone} patientId={patientId} />

      <AiHintsCard />

      <ConversationHistoryCard
        messages={messages}
        isLoading={messagesQuery.isLoading}
      />

      <TelegramStatsCard
        messages={messages}
        unreadCount={conversation.unreadCount}
        lastMessageAt={conversation.lastMessageAt}
      />

      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
        onCreated={() => {
          setDialogOpen(false);
          toast.success(t("appointmentCreated"));
        }}
      />
    </div>
  );
}

function PatientHeaderCard({
  name,
  photoUrl,
  phone,
  segment,
  balance,
  lifetimeSpend,
  isLoading,
  onBook,
  openPatientHref,
  openPatientLabel,
  bookLabel,
  segmentLabel,
  balanceLabel,
  lifetimeSpendLabel,
}: {
  name: string;
  photoUrl: string | null;
  phone: string | null;
  segment: string | null;
  balance: number | bigint;
  lifetimeSpend: number | bigint;
  isLoading: boolean;
  onBook: () => void;
  openPatientHref: string;
  openPatientLabel: string;
  bookLabel: string;
  segmentLabel: string;
  balanceLabel: string;
  lifetimeSpendLabel: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-start gap-3">
        <AvatarWithStatus name={name} src={photoUrl} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          {phone ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <PhoneText phone={phone} />
            </div>
          ) : null}
          {segment ? (
            <span className="mt-1 inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {segmentLabel}: {segment}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <MiniStat label={lifetimeSpendLabel}>
          {isLoading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <MoneyText amount={lifetimeSpend} currency="UZS" className="text-[13px] font-semibold" />
          )}
        </MiniStat>
        <MiniStat label={balanceLabel}>
          {isLoading ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <MoneyText amount={balance} currency="UZS" className="text-[13px] font-semibold" />
          )}
        </MiniStat>
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onBook} className="flex-1">
          <CalendarPlusIcon className="size-3" />
          {bookLabel}
        </Button>
        <Link
          href={openPatientHref}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "flex-1",
          )}
        >
          <ExternalLinkIcon className="size-3" />
          {openPatientLabel}
        </Link>
      </div>
    </section>
  );
}

function ActionTileGrid({
  phone,
  patientId,
}: {
  phone: string | null;
  patientId: string;
}) {
  const t = useTranslations("tgInbox.rail.actions");

  const copyPhone = async () => {
    if (!phone || typeof navigator === "undefined") return;
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t("phoneCopied"));
    } catch {
      toast.error(t("copyFailed"));
    }
  };

  const onStub = (key: string) => () => toast.info(t(`stubs.${key}`));

  const callHref = phone ? `tel:${phone.replace(/\s/g, "")}` : "#";
  const smsHref = `/crm/patients/${patientId}?sms=true`;

  return (
    <section
      aria-label={t("ariaLabel")}
      className="rounded-xl border border-border bg-background p-3"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("title")}
      </h3>
      <div className="grid grid-cols-3 gap-2">
        <a
          href={callHref}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted",
            !phone && "pointer-events-none opacity-50",
          )}
        >
          <PhoneIcon className="size-4 text-primary" aria-hidden />
          <span className="text-[11px] font-medium">{t("call")}</span>
        </a>
        <Link
          href={smsHref}
          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted"
        >
          <MessageSquareIcon className="size-4 text-primary" aria-hidden />
          <span className="text-[11px] font-medium">{t("sms")}</span>
        </Link>
        <button
          type="button"
          onClick={copyPhone}
          className={cn(
            "flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted",
            !phone && "pointer-events-none opacity-50",
          )}
        >
          <CopyIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium">{t("copyPhone")}</span>
        </button>
        <button
          type="button"
          onClick={onStub("attachment")}
          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted"
        >
          <FileUpIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium">{t("attachment")}</span>
        </button>
        <button
          type="button"
          onClick={onStub("task")}
          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted"
        >
          <ClockIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium">{t("task")}</span>
        </button>
        <button
          type="button"
          onClick={onStub("export")}
          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-card p-2 text-center transition hover:bg-muted"
        >
          <DownloadIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-[11px] font-medium">{t("export")}</span>
        </button>
      </div>
    </section>
  );
}

function AiHintsCard() {
  const t = useTranslations("tgInbox.rail.ai");
  return (
    <section
      aria-label={t("ariaLabel")}
      className="rounded-xl border border-border bg-background p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <SparklesIcon
          className="size-4 text-info"
          aria-hidden
        />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h3>
      </header>
      <ul className="space-y-1.5">
        {[1, 2, 3].map((idx) => (
          <li
            key={idx}
            className="rounded-md bg-muted/60 px-2.5 py-1.5 text-[12px] leading-snug text-foreground"
          >
            {t(`tip${idx}`)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {t("disclaimer")}
      </p>
    </section>
  );
}

function ConversationHistoryCard({
  messages,
  isLoading,
}: {
  messages: { id: string; body: string | null; direction: "IN" | "OUT"; createdAt: string }[];
  isLoading: boolean;
}) {
  const t = useTranslations("tgInbox.rail.history");
  const locale = useLocale();

  const recent = messages.slice(-4).reverse();

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    }).format(d);
  };

  return (
    <section
      aria-label={t("ariaLabel")}
      className="rounded-xl border border-border bg-background p-3"
    >
      <header className="mb-2 flex items-center gap-2">
        <HistoryIcon className="size-4 text-muted-foreground" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </h3>
      </header>
      {isLoading && recent.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          {t("loading")}
        </p>
      ) : recent.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {recent.map((m) => (
            <li
              key={m.id}
              className="flex items-start gap-2 text-[12px] leading-snug"
            >
              <span
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  m.direction === "IN" ? "bg-primary" : "bg-muted-foreground",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-foreground">
                  {m.body?.trim() || t("noText")}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                  {fmtTime(m.createdAt)} ·{" "}
                  {t(m.direction === "IN" ? "in" : "out")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TelegramStatsCard({
  messages,
  unreadCount,
  lastMessageAt,
}: {
  messages: { direction: "IN" | "OUT" }[];
  unreadCount: number;
  lastMessageAt: string | null;
}) {
  const t = useTranslations("tgInbox.rail.stats");
  const locale = useLocale();

  const inbound = messages.filter((m) => m.direction === "IN").length;
  const outbound = messages.filter((m) => m.direction === "OUT").length;
  const total = messages.length;

  const lastLabel = lastMessageAt
    ? new Intl.DateTimeFormat(locale === "uz" ? "uz-UZ" : "ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lastMessageAt))
    : null;

  return (
    <section
      aria-label={t("ariaLabel")}
      className="rounded-xl border border-border bg-background p-3"
    >
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("title")}
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label={t("total")}>
          <span className="text-[13px] font-semibold tabular-nums">{total}</span>
        </MiniStat>
        <MiniStat label={t("unread")}>
          <span
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              unreadCount > 0 ? "text-primary" : undefined,
            )}
          >
            {unreadCount}
          </span>
        </MiniStat>
        <MiniStat label={t("inbound")}>
          <span className="text-[13px] font-semibold tabular-nums">{inbound}</span>
        </MiniStat>
        <MiniStat label={t("outbound")}>
          <span className="text-[13px] font-semibold tabular-nums">{outbound}</span>
        </MiniStat>
      </div>
      {lastLabel ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("lastActivity", { time: lastLabel })}
        </p>
      ) : null}
    </section>
  );
}

function MiniStat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-foreground">{children}</div>
    </div>
  );
}

function CreatePatientForm({
  conversation,
}: {
  conversation: InboxConversation;
}) {
  const t = useTranslations("tgInbox.rail");
  const qc = useQueryClient();

  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");

  const create = useMutation({
    mutationFn: async () => {
      if (!fullName.trim()) {
        throw new Error("NAME_REQUIRED");
      }
      if (!phone.trim()) {
        throw new Error("PHONE_REQUIRED");
      }
      const res = await fetch(`/api/crm/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          source: "TELEGRAM",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const patient = (await res.json()) as { id: string };

      const patchRes = await fetch(
        `/api/crm/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ patientId: patient.id }),
        },
      );
      if (!patchRes.ok) {
        throw new Error(`Link failed: ${patchRes.status}`);
      }
      return patient;
    },
    onSuccess: () => {
      toast.success(t("patientCreated"));
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
      void qc.invalidateQueries({
        queryKey: conversationsKey({ q: "", mode: "all", unreadOnly: false }),
      });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Create failed");
    },
  });

  return (
    <div className="space-y-4">
      <EmptyState
        icon={<UserPlusIcon />}
        title={t("noPatientTitle")}
        description={t("noPatientDescription")}
      />
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-name" className="text-xs">
            {t("fullNameLabel")}
          </Label>
          <Input
            id="tg-new-patient-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t("fullNamePlaceholder")}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-phone" className="text-xs">
            {t("phoneLabel")}
          </Label>
          <Input
            id="tg-new-patient-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 ..."
            className="h-8"
          />
        </div>
        <Button
          onClick={() => create.mutate()}
          disabled={
            create.isPending || fullName.trim() === "" || phone.trim() === ""
          }
          size="sm"
          className="w-full"
        >
          {create.isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <UserPlusIcon className="size-3" />
          )}
          {t("createPatient")}
        </Button>
      </div>
    </div>
  );
}
