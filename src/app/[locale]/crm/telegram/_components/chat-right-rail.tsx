"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  CalendarPlusIcon,
  CopyIcon,
  IdCardIcon,
  LayoutGridIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlusIcon,
  SendIcon,
  TagIcon,
  UnlinkIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { readPlanLimit } from "@/lib/plan-limit";
import {
  isPrivateChatId,
  isUnconfirmedMiniAppCard,
  threadProfileName,
} from "@/lib/patients/telegram-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/atoms/empty-state";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import { MoneyText } from "@/components/atoms/money-text";
import { CountUp } from "@/components/atoms/count-up";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";
import { bookingChannelForConversation } from "@/components/appointments/new-appointment-dialog/types";
import {
  PhoneOwnerMismatchError,
  PhoneOwnerPrompt,
  readPhoneOwnerMismatch,
  type PhoneOwnerAnswer,
  type PhoneOwnerSummary,
} from "@/components/appointments/phone-owner-prompt";

import type { InboxConversation, InboxMessage } from "../_hooks/types";
import { invalidateConversationCaches } from "../_hooks/use-conversations";
import { useUpdateConversationMeta } from "../_hooks/use-conversation-meta";
import { flattenMessages, useTgMessages } from "../_hooks/use-tg-messages";
import { useMarkConversationRead } from "../_hooks/use-mark-read";
import {
  dispatchOpenAppointment,
  useOpenAppointment,
} from "../_hooks/use-tg-events";
import {
  avgStaffReplySeconds,
  chatMessageCounts,
  durationParts,
} from "../_lib/chat-stats";
import { createPatientErrorKey } from "../_lib/create-patient-error";
import { unlinkErrorKey } from "../_lib/unlink-error";

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
  ltv: number | bigint | null;
  lastVisitAt: string | null;
  source?: string | null;
  phoneNormalized?: string | null;
  phoneVerifiedAt?: string | null;
  telegramId?: string | null;
};

/** Server-side clinical KPIs from /api/crm/patients/[id]/stats. */
type PatientClinicalStats = {
  segment: string | null;
  visitsCount: number;
  lastVisitAt: string | null;
  birthDate: string | null;
  noShowCount: number;
  totalAppointments: number;
  /** COMPLETED + NO_SHOW: what noShowPct is a share of (audit G6-12). */
  settledAppointments: number;
  noShowPct: number;
  avgCheck: number;
};

const KNOWN_SEGMENTS = new Set(["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"]);

function segmentTone(segment: string): string {
  switch (segment) {
    case "VIP":
      return "bg-info/15 text-[color:var(--info)]";
    case "ACTIVE":
      return "bg-success/15 text-[color:var(--success)]";
    case "DORMANT":
      return "bg-warning/15 text-[color:var(--warning)]";
    case "CHURN":
      return "bg-destructive/15 text-destructive";
    default:
      return "bg-primary/10 text-primary";
  }
}

function ageFromBirth(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function relativeVisit(at: string | null, locale: string): string | null {
  if (!at) return null;
  const then = new Date(at).getTime();
  if (!Number.isFinite(then)) return null;
  const diffDays = Math.round((Date.now() - then) / (24 * 60 * 60 * 1000));
  const rtf = new Intl.RelativeTimeFormat(locale === "uz" ? "uz" : "ru", {
    numeric: "auto",
  });
  if (diffDays < 30) return rtf.format(-diffDays, "day");
  const months = Math.round(diffDays / 30);
  if (months < 12) return rtf.format(-months, "month");
  return rtf.format(-Math.round(diffDays / 365), "year");
}

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

  // Keyed by dialog: the name and phone typed for one unlinked chat must not
  // carry over to the next chat (audit G6-01); the booking dialog is keyed
  // the same way by the page (ChatBookingDialog).
  if (!conversation.patientId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <CreatePatientForm key={conversation.id} conversation={conversation} />
        <TagsCard key={`tags-${conversation.id}`} conversation={conversation} />
      </div>
    );
  }

  return <LinkedPatientRail key={conversation.id} conversation={conversation} />;
}

/**
 * The open chat's booking dialog. The page mounts it next to the chat, not
 * inside the rail (audit G6-11): the composer's «Записать на приём» fires an
 * event, and with the rail hidden nobody was listening, so the button did
 * nothing. The rail's «Записать» fires the same event. The page keys it by
 * dialog, so an open dialog never carries over to the next chat (G6-01).
 */
export function ChatBookingDialog({
  conversation,
}: {
  conversation: InboxConversation;
}) {
  const t = useTranslations("tgInbox.rail");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  useOpenAppointment(conversation.id, () => setDialogOpen(true));

  if (!conversation.patientId) return null;
  // A booking made from the chat is a Telegram booking, not a phone one,
  // and is not auto-confirmed (audit G6-02).
  return (
    <NewAppointmentDialog
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      patientId={conversation.patientId}
      initialChannel={bookingChannelForConversation(conversation.channel)}
      onCreated={() => {
        setDialogOpen(false);
        toast.success(t("appointmentCreated"));
      }}
    />
  );
}

function LinkedPatientRail({ conversation }: { conversation: InboxConversation }) {
  const t = useTranslations("tgInbox.rail");
  const locale = useLocale();

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

  const statsQuery = useQuery<PatientClinicalStats>({
    queryKey: ["patient-clinical-stats", conversation.patientId],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        `/api/crm/patients/${conversation.patientId}/stats`,
        { credentials: "include", signal },
      );
      if (!res.ok) throw new Error(`Load failed: ${res.status}`);
      return (await res.json()) as PatientClinicalStats;
    },
    enabled: Boolean(conversation.patientId),
    staleTime: 60_000,
  });

  const messagesQuery = useTgMessages(conversation.id);
  const messages = React.useMemo(
    () => flattenMessages(messagesQuery.data?.pages),
    [messagesQuery.data],
  );

  const p = detailsQuery.data;
  const stats = statsQuery.data;
  const age = ageFromBirth(stats?.birthDate ?? null);
  const segment = stats?.segment ?? p?.segment ?? null;
  const displayName =
    p?.fullName ?? conversation.patient?.fullName ?? t("anonymous");
  const phone = p?.phone ?? conversation.patient?.phone ?? null;
  const photo = p?.photoUrl ?? conversation.patient?.photoUrl ?? null;
  const patientId = conversation.patientId!;
  // The bot tied the chat to the card the Mini App made on first open
  // (audit TG-11 review): nobody has confirmed who it is, and the patient
  // may well have a clinic card with his history. Reception can still move
  // the chat there; the stub makes way once the account follows.
  const miniAppCard = p ? isUnconfirmedMiniAppCard(p) : false;
  // The chat's account is not the card's Telegram yet: either the link was
  // never confirmed (a card with history, another name) or it predates
  // TG-11. Binding it is an explicit, warned step.
  const telegramUnbound =
    !!p &&
    !p.telegramId &&
    conversation.channel === "TG" &&
    isPrivateChatId(conversation.externalId);
  // A bot chat tied to the wrong card can be untied (audit G6-14). The
  // in-app chat of the Mini App and a thread opened from the card belong to
  // that card and have no Telegram account to move elsewhere. Nor does an
  // unconfirmed Mini App card's chat: the card holds the account, so the
  // bot would tie the chat back; the relink form above is how it moves.
  const canUnlink =
    conversation.channel === "TG" &&
    isPrivateChatId(conversation.externalId) &&
    !miniAppCard;

  return (
    <div
      key={patientId}
      className="motion-stagger flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 [&>*]:motion-rise-in"
    >
      <PatientIdentityCard
        name={displayName}
        photoUrl={photo}
        phone={phone}
        externalId={conversation.externalId}
        username={conversation.contactUsername}
        segment={segment}
        age={age}
        isLoading={detailsQuery.isLoading}
      />

      {miniAppCard ? (
        <CreatePatientForm conversation={conversation} relink />
      ) : null}

      {telegramUnbound ? (
        <TelegramBindCard
          conversation={conversation}
          patientId={patientId}
          patientName={displayName}
        />
      ) : null}

      <LtvBalanceCard
        balance={p?.balance ?? 0}
        ltv={p?.ltv ?? 0}
        isLoading={detailsQuery.isLoading}
      />

      <ClinicalStatsCard
        stats={stats}
        isLoading={statsQuery.isLoading}
        locale={locale}
      />

      <QuickActionsRow
        phone={phone}
        patientId={patientId}
        locale={locale}
        onBook={() => dispatchOpenAppointment({ conversationId: conversation.id })}
      />

      <TagsCard conversation={conversation} />

      {/* No «AI-ассистент» (audit G6-16: a hard-coded «уверенность 92%» over
          three Russian keywords, waiting for AI_ENABLED to come alive) and
          no «Связанные темы» (G6-13: Russian substrings, blind to Uzbek).
          A real AI service brings its own card. */}

      <TelegramStatsCard
        messages={messages}
        conversation={conversation}
      />

      {canUnlink ? (
        <UnlinkPatientCard
          conversation={conversation}
          patientId={patientId}
          patientName={displayName}
          ownsTelegram={!!p?.telegramId && p.telegramId === conversation.externalId}
        />
      ) : null}
    </div>
  );
}

function PatientIdentityCard({
  name,
  photoUrl,
  phone,
  externalId,
  username,
  segment,
  age,
  isLoading,
}: {
  name: string;
  photoUrl: string | null;
  phone: string | null;
  externalId: string | null;
  username: string | null;
  segment: string | null;
  age: number | null;
  isLoading: boolean;
}) {
  const t = useTranslations("tgInbox.rail");
  const segmentLabel =
    segment && KNOWN_SEGMENTS.has(segment)
      ? t(`segmentLabels.${segment}`)
      : null;
  const copyPhone = async () => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      toast.success(t("actions.phoneCopied"));
    } catch {
      toast.error(t("actions.copyFailed"));
    }
  };

  return (
    <section className="flex flex-col items-center gap-3 pb-2">
      <AvatarWithStatus name={name} src={photoUrl} size="lg" />
      <div className="flex flex-col items-center gap-1">
        {/* No «верифицирован» badge (audit G6-16): no API ever sent the
            flag, so it could not show. */}
        <span className="text-[15px] font-bold text-foreground">{name}</span>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          {externalId ? (
            <span className="inline-flex items-center gap-1">
              <IdCardIcon className="size-3" aria-hidden />
              ID: {externalId}
            </span>
          ) : null}
          {externalId ? <span aria-hidden>·</span> : null}
          {age !== null ? (
            <>
              <span className="tabular-nums">{t("years", { age })}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          {segmentLabel ? (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 font-semibold uppercase tracking-wide",
                segmentTone(segment!),
              )}
            >
              {segmentLabel}
            </span>
          ) : (
            <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium">
              {t("patientTag")}
            </span>
          )}
        </div>
      </div>

      <div className="flex w-full flex-col gap-2 pt-1">
        {phone ? (
          <div className="flex items-center gap-2 text-[13px]">
            <PhoneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 truncate tabular-nums text-foreground">
              {phone}
            </span>
            <button
              type="button"
              onClick={copyPhone}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("actions.copyPhone")}
            >
              <CopyIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
        {username ? (
          <div className="flex items-center gap-2 text-[13px]">
            <SendIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 truncate text-foreground">@{username}</span>
          </div>
        ) : null}
        {isLoading && !phone && !username ? (
          <div className="flex justify-center py-1">
            <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LtvBalanceCard({
  balance,
  ltv,
  isLoading,
}: {
  balance: number | bigint;
  ltv: number | bigint;
  isLoading: boolean;
}) {
  const t = useTranslations("tgInbox.rail");
  const balanceNum = typeof balance === "bigint" ? Number(balance) : balance;
  const isNegative = balanceNum < 0;

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("ltv")}
          </div>
          <div className="mt-1 text-[14px] font-bold text-foreground tabular-nums">
            {isLoading ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <MoneyText amount={ltv} currency="UZS" />
            )}
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t("balance")}
          </div>
          {/* No «Пополнить» (audit G6-09): nothing handled its link, and
              the CRM records no payments to top a balance up with. */}
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={cn(
                "text-[14px] font-bold tabular-nums",
                isNegative ? "text-destructive" : "text-foreground",
              )}
            >
              {isLoading ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <MoneyText amount={balance} currency="UZS" />
              )}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuickActionsRow({
  phone,
  patientId,
  locale,
  onBook,
}: {
  phone: string | null;
  patientId: string;
  locale: string;
  onBook: () => void;
}) {
  const t = useTranslations("tgInbox.rail.actions");

  const tiles: {
    key: string;
    icon: React.ReactNode;
    label: string;
    href?: string;
    onClick?: () => void;
    disabled?: boolean;
  }[] = [
    {
      key: "call",
      icon: <PhoneIcon className="size-4" />,
      label: t("call"),
      href: phone ? `tel:${phone.replace(/\s/g, "")}` : undefined,
      disabled: !phone,
    },
    {
      key: "book",
      icon: <CalendarPlusIcon className="size-4" />,
      label: t("book"),
      onClick: onBook,
    },
    {
      key: "card",
      icon: <IdCardIcon className="size-4" />,
      label: t("card"),
      href: `/${locale}/crm/patients/${patientId}`,
    },
  ];

  return (
    <section className="grid grid-cols-4 gap-1.5">
      {tiles.map((tile) =>
        tile.href ? (
          <Link
            key={tile.key}
            href={tile.href}
            className={cn(
              "motion-hover-lift motion-press flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-center transition-colors hover:border-primary/30 hover:bg-primary/5",
              tile.disabled && "pointer-events-none opacity-50 motion-safe:hover:translate-y-0",
            )}
          >
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {tile.icon}
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {tile.label}
            </span>
          </Link>
        ) : (
          <button
            key={tile.key}
            type="button"
            onClick={tile.onClick}
            disabled={tile.disabled}
            className="flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-center transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {tile.icon}
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {tile.label}
            </span>
          </button>
        ),
      )}
      <MoreActionsTile patientId={patientId} locale={locale} />
    </section>
  );
}

function MoreActionsTile({
  patientId,
  locale,
}: {
  patientId: string;
  locale: string;
}) {
  const t = useTranslations("tgInbox.rail.actions");
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="motion-hover-lift motion-press flex flex-col items-center gap-1 rounded-xl border border-border bg-card p-2 text-center transition-colors hover:border-primary/30 hover:bg-primary/5"
        >
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-muted text-foreground">
            <MoreHorizontalIcon className="size-4" />
          </span>
          <span className="text-[10px] font-medium text-foreground">
            {t("more")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1">
        <Link
          href={`/${locale}/crm/patients/${patientId}?tab=cases`}
          onClick={() => setOpen(false)}
          className="flex items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("openCases")}
        </Link>
        <Link
          href={`/${locale}/crm/patients/${patientId}?tab=payments`}
          onClick={() => setOpen(false)}
          className="flex items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("openPayments")}
        </Link>
        <Link
          href={`/${locale}/crm/patients/${patientId}?tab=documents`}
          onClick={() => setOpen(false)}
          className="flex items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted"
        >
          {t("openDocuments")}
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function ClinicalStatsCard({
  stats,
  isLoading,
  locale,
}: {
  stats: PatientClinicalStats | undefined;
  isLoading: boolean;
  locale: string;
}) {
  const t = useTranslations("tgInbox.rail.clinic");

  // A share of the visits that happened (audit G6-12); none yet, no rate.
  const risk: { label: string; tone: string } | null = !stats
    ? null
    : stats.settledAppointments === 0
      ? { label: t("riskNone"), tone: "text-muted-foreground" }
      : stats.noShowPct === 0
        ? { label: t("riskLow"), tone: "text-[color:var(--success)]" }
        : stats.noShowPct < 15
          ? { label: t("riskMedium"), tone: "text-[color:var(--warning)]" }
          : { label: t("riskHigh"), tone: "text-destructive" };

  const lastVisit = relativeVisit(stats?.lastVisitAt ?? null, locale);

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <header className="mb-3 flex items-center gap-1.5">
        <ActivityIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
      </header>
      <div className="grid grid-cols-2 gap-2">
        <ClinicalTile label={t("visits")}>
          {isLoading ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <CountUp to={stats?.visitsCount ?? 0} />
          )}
        </ClinicalTile>

        <ClinicalTile label={t("noShowRisk")}>
          {isLoading || !risk ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : stats && stats.settledAppointments > 0 ? (
            <span className="flex items-baseline gap-1">
              <span className={cn("tabular-nums", risk.tone)}>
                {stats.noShowPct}%
              </span>
              <span className={cn("text-[10px] font-semibold", risk.tone)}>
                {risk.label}
              </span>
            </span>
          ) : (
            <span className={cn("text-[12px] font-semibold", risk.tone)}>
              {risk.label}
            </span>
          )}
        </ClinicalTile>

        <ClinicalTile label={t("avgCheck")}>
          {isLoading ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : stats && stats.avgCheck > 0 ? (
            <MoneyText amount={stats.avgCheck} currency="UZS" />
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </ClinicalTile>

        <ClinicalTile label={t("lastVisit")}>
          {isLoading ? (
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <span className="text-[13px]">{lastVisit ?? t("never")}</span>
          )}
        </ClinicalTile>
      </div>
    </section>
  );
}

function ClinicalTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2">
      <span className="text-[10px] leading-tight text-muted-foreground">
        {label}
      </span>
      <span className="mt-0.5 text-[18px] font-bold leading-none tabular-nums text-foreground">
        {children}
      </span>
    </div>
  );
}

function TelegramStatsCard({
  messages,
  conversation,
}: {
  messages: InboxMessage[];
  conversation: InboxConversation;
}) {
  const t = useTranslations("tgInbox.rail.stats");
  const markRead = useMarkConversationRead();
  // Over the loaded messages, and the header says so (audit G6-17): staff
  // replies apart from the bot's, the reply time to a staff answer only.
  const counts = React.useMemo(() => chatMessageCounts(messages), [messages]);
  const unread = conversation.unreadCount;
  const avgReplySec = React.useMemo(
    () => avgStaffReplySeconds(messages),
    [messages],
  );

  const tiles: StatTile[] = [
    {
      key: "fromPatient",
      label: t("fromPatient"),
      value: counts.fromPatient,
      kind: "count",
      tone: "info",
    },
    {
      key: "staffReplies",
      label: t("staffReplies"),
      value: counts.staffReplies,
      kind: "count",
      tone: "primary",
    },
    {
      key: "botReplies",
      label: t("botReplies"),
      value: counts.botReplies,
      kind: "count",
      tone: "neutral",
    },
    {
      key: "avgReply",
      label: t("avgStaffReply"),
      value: avgReplySec,
      kind: "duration",
      tone: "success",
    },
  ];

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <LayoutGridIcon
            className="size-3.5 text-muted-foreground"
            aria-hidden
          />
          <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">{t("loadedScope")}</span>
      </header>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <StatTileView key={tile.key} tile={tile} />
        ))}
      </div>
      {unread > 0 ? (
        <button
          type="button"
          onClick={() => markRead.mutate(conversation.id)}
          disabled={markRead.isPending}
          className="motion-press mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px] font-medium text-[color:var(--warning)] transition-colors hover:bg-warning/15 disabled:opacity-50"
        >
          {markRead.isPending ? (
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
          ) : null}
          {t("markRead", { n: unread })}
        </button>
      ) : null}
    </section>
  );
}

type StatTone = "neutral" | "primary" | "info" | "success";

type StatTile = {
  key: string;
  label: string;
  value: number | null;
  kind: "count" | "duration";
  tone: StatTone;
};

function StatTileView({ tile }: { tile: StatTile }) {
  const t = useTranslations("tgInbox.rail.stats");
  const empty = tile.value === null || tile.value === 0;
  const tone = {
    neutral: {
      ring: "hover:border-foreground/20",
      value: "text-foreground",
      accent: "from-foreground/0 via-foreground/0 to-foreground/0",
    },
    primary: {
      ring: "hover:border-primary/40",
      value: "text-foreground group-hover:text-primary",
      accent: "from-primary/0 via-primary/0 to-primary/25",
    },
    info: {
      ring: "hover:border-info/40",
      value: "text-foreground group-hover:text-[color:var(--info)]",
      accent: "from-info/0 via-info/0 to-info/25",
    },
    success: {
      ring: "hover:border-success/40",
      value: "text-foreground group-hover:text-[color:var(--success)]",
      accent: "from-success/0 via-success/0 to-success/25",
    },
  }[tile.tone];
  return (
    <div
      className={cn(
        "motion-hover-lift group relative flex flex-col gap-0.5 overflow-hidden rounded-xl border border-border/60 bg-muted/30 px-2.5 py-2 transition-colors",
        tone.ring,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          tone.accent,
        )}
        aria-hidden
      />
      <span className="text-[10px] leading-tight text-muted-foreground">
        {tile.label}
      </span>
      <span
        className={cn(
          "mt-0.5 text-[18px] font-bold leading-none tabular-nums transition-colors",
          tone.value,
        )}
      >
        {empty ? (
          <span className="text-muted-foreground/60">—</span>
        ) : tile.kind === "duration" ? (
          formatDuration(tile.value!, t)
        ) : (
          <CountUp to={tile.value!} />
        )}
      </span>
    </div>
  );
}

/** «45 с», «12 мин», «1,5 ч»: the unit in the operator's language (G6-17). */
function formatDuration(
  seconds: number,
  t: ReturnType<typeof useTranslations<"tgInbox.rail.stats">>,
): string {
  const { unit, n } = durationParts(seconds);
  if (unit === "sec") return t("durationSec", { n });
  if (unit === "min") return t("durationMin", { n });
  return t("durationHour", { n });
}

function TagsCard({ conversation }: { conversation: InboxConversation }) {
  const t = useTranslations("tgInbox.rail.tags");
  const update = useUpdateConversationMeta(conversation.id);
  const [draft, setDraft] = React.useState("");
  const tags = conversation.tags ?? [];

  const commit = (next: string[]) => {
    update.mutate(
      { tags: next },
      {
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : t("error")),
      },
    );
  };

  const addTag = () => {
    const value = draft.trim();
    if (!value) return;
    setDraft("");
    if (tags.some((x) => x.toLowerCase() === value.toLowerCase())) return;
    commit([...tags, value]);
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <header className="mb-2 flex items-center gap-1.5">
        <TagIcon className="size-3.5 text-muted-foreground" aria-hidden />
        <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
      </header>
      {tags.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2 pr-1 text-[11px] font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={() => commit(tags.filter((x) => x !== tag))}
                disabled={update.isPending}
                className="inline-flex size-4 items-center justify-center rounded-full text-primary/70 transition-colors hover:bg-primary/15 hover:text-primary disabled:opacity-50"
                aria-label={t("remove", { tag })}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="mb-2 text-[11px] text-muted-foreground">{t("empty")}</p>
      )}
      <div className="flex items-center gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={t("placeholder")}
          maxLength={32}
          className="h-7 text-[12px]"
        />
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={addTag}
          disabled={update.isPending || draft.trim() === ""}
        >
          {update.isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <PlusIcon className="size-3" />
          )}
          {t("add")}
        </Button>
      </div>
    </section>
  );
}

/** `telegramLink` of the conversation PATCH (server/conversations/link-patient.ts). */
type TelegramLinkOutcome =
  | { kind: "already-linked" | "linked" | "card-has-other-telegram" }
  | { kind: "telegram-on-other-card"; otherPatientName: string }
  | { kind: "needs-confirm"; reason: "history" | "name" };

/** Tell the operator what linking did to the card's Telegram. */
function announceTelegramLink(
  link: TelegramLinkOutcome | null,
  t: ReturnType<typeof useTranslations<"tgInbox.rail">>,
): void {
  if (link?.kind === "card-has-other-telegram") {
    toast.warning(t("telegramKeptOther"));
  } else if (link?.kind === "telegram-on-other-card") {
    toast.warning(t("telegramOnOtherCard", { name: link.otherPatientName }));
  } else if (link?.kind === "needs-confirm") {
    toast.info(t("telegramNeedsConfirm"));
  }
}

/**
 * The chat's Telegram account is not the linked card's (audit TG-11
 * review). Binding it gives whoever writes in this chat the card in the
 * Mini App and the doctor's conclusions, so it is never a side effect of
 * typing a name and a number: the operator reads the warning and confirms.
 */
function TelegramBindCard({
  conversation,
  patientId,
  patientName,
}: {
  conversation: InboxConversation;
  patientId: string;
  patientName: string;
}) {
  const t = useTranslations("tgInbox.rail.telegramBind");
  const tRail = useTranslations("tgInbox.rail");
  const qc = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);
  const account =
    threadProfileName(conversation) ??
    (conversation.contactUsername
      ? `@${conversation.contactUsername}`
      : conversation.externalId ?? "");

  const bind = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ linkTelegram: true }),
      });
      if (res.status === 403) throw new Error(t("forbidden"));
      if (!res.ok) throw new Error(t("failed"));
      const j = (await res.json().catch(() => null)) as {
        telegramLink?: TelegramLinkOutcome | null;
      } | null;
      return j?.telegramLink ?? null;
    },
    onSuccess: (link) => {
      setConfirming(false);
      if (link?.kind === "linked" || link?.kind === "already-linked") {
        toast.success(tRail("telegramLinked"));
      } else if (!link) {
        toast.error(t("failed"));
      } else {
        announceTelegramLink(link, tRail);
      }
      void qc.invalidateQueries({ queryKey: ["patient-mini", patientId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("failed"));
    },
  });

  return (
    <section className="rounded-2xl border border-warning/40 bg-warning/5 p-3">
      <header className="mb-1 flex items-center gap-1.5">
        <SendIcon className="size-3.5 text-[color:var(--warning)]" aria-hidden />
        <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
      </header>
      <p className="text-[11px] text-muted-foreground">{t("description")}</p>
      {account ? (
        <p className="mt-1 truncate text-[11px] text-foreground">
          {t("account", { name: account })}
        </p>
      ) : null}
      {confirming ? (
        <div className="mt-2 space-y-2">
          <p className="text-[12px] leading-snug text-foreground">
            {t("warning", { name: patientName })}
          </p>
          <div className="flex gap-1.5">
            <Button
              type="button"
              size="xs"
              onClick={() => bind.mutate()}
              disabled={bind.isPending}
            >
              {bind.isPending ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : null}
              {t("confirm")}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setConfirming(false)}
              disabled={bind.isPending}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          size="xs"
          variant="outline"
          className="mt-2"
          onClick={() => setConfirming(true)}
        >
          {t("action")}
        </Button>
      )}
    </section>
  );
}

/**
 * Unties a bot chat from its card (audit G6-14): typed onto the wrong
 * patient, the chat showed her visits, booked onto her card and was read by
 * her doctor, and only the database could undo it. Untied, the rail offers
 * the name and phone form again, so this is also how the chat moves to
 * another card. When the card holds the chat's Telegram the bot would tie
 * the chat back on the next message: an account the inbox wrote there
 * leaves with the chat, and one the card got otherwise (an invite, the
 * Mini App) keeps the chat, which the server answers in words.
 */
function UnlinkPatientCard({
  conversation,
  patientId,
  patientName,
  ownsTelegram,
}: {
  conversation: InboxConversation;
  patientId: string;
  patientName: string;
  ownsTelegram: boolean;
}) {
  const t = useTranslations("tgInbox.rail.unlink");
  const qc = useQueryClient();
  const [confirming, setConfirming] = React.useState(false);

  const unlink = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ patientId: null }),
      });
      const j: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        throw new RailMessageError(
          t(unlinkErrorKey(res.status, j), { name: patientName }),
        );
      }
      return (j as { telegramUnlinked?: boolean } | null)?.telegramUnlinked === true;
    },
    onSuccess: (telegramUnlinked) => {
      setConfirming(false);
      toast.success(telegramUnlinked ? t("doneWithTelegram") : t("done"));
      // The card may have just lost the chat's Telegram.
      void qc.invalidateQueries({ queryKey: ["patient-mini", patientId] });
      invalidateConversationCaches(qc);
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(err instanceof RailMessageError ? err.message : t("failed"));
    },
  });

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center justify-center gap-1.5 self-center rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <UnlinkIcon className="size-3" aria-hidden />
        {t("action")}
      </button>
    );
  }

  return (
    <section className="space-y-2 rounded-2xl border border-border bg-card p-3">
      <p className="text-[12px] leading-snug text-foreground">
        {t("warning", { name: patientName })}
      </p>
      {ownsTelegram ? (
        <p className="text-[12px] leading-snug text-muted-foreground">
          {t("warningTelegram")}
        </p>
      ) : null}
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="xs"
          variant="destructive"
          onClick={() => unlink.mutate()}
          disabled={unlink.isPending}
        >
          {unlink.isPending ? <Loader2Icon className="size-3 animate-spin" /> : null}
          {t("confirm")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setConfirming(false)}
          disabled={unlink.isPending}
        >
          {t("cancel")}
        </Button>
      </div>
    </section>
  );
}

/** A refusal already worded for the toast (audit G6-14). */
class RailMessageError extends Error {}

/**
 * Name + phone → the patient's card (found by the number, or created), and
 * the chat is tied to it. `relink`: the chat already sits on an unconfirmed
 * Mini App card and reception moves it to the clinic's card.
 */
function CreatePatientForm({
  conversation,
  relink = false,
}: {
  conversation: InboxConversation;
  relink?: boolean;
}) {
  const t = useTranslations("tgInbox.rail");
  const tLimit = useTranslations("crmToasts.patient.planLimit");
  const qc = useQueryClient();

  const [fullName, setFullName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  // The number leads to a card with another name, or to an unconfirmed Mini
  // App card (audit Q-03, PH-01): linking the chat to it needs an answer.
  const [ownerConflict, setOwnerConflict] =
    React.useState<PhoneOwnerSummary | null>(null);

  const create = useMutation({
    mutationFn: async (phoneOwner?: PhoneOwnerAnswer) => {
      if (!fullName.trim() || !phone.trim()) {
        throw new RailMessageError(t("createErrors.invalid"));
      }
      const res = await fetch(`/api/crm/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim(),
          source: "TELEGRAM",
          ...(phoneOwner ? { phoneOwner } : {}),
        }),
      });

      let patientId: string;
      let reused = false;
      if (res.ok) {
        const created = (await res.json()) as { id: string };
        patientId = created.id;
      } else if (res.status === 409) {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
          reason?: string;
          patientId?: string;
        } | null;
        const owner = readPhoneOwnerMismatch(res.status, j);
        if (owner) throw new PhoneOwnerMismatchError(owner);
        if (j?.reason === "phone_already_exists" && j.patientId) {
          patientId = j.patientId;
          reused = true;
        } else {
          throw new RailMessageError(t("createErrors.failed"));
        }
      } else {
        const j: unknown = await res.json().catch(() => null);
        // The plan's patient limit, said the way the patient list says it.
        const limit = readPlanLimit(res.status, j);
        if (limit) {
          throw new RailMessageError(tLimit(limit.quota, { max: limit.max }));
        }
        throw new RailMessageError(
          t(`createErrors.${createPatientErrorKey(res.status, j)}`),
        );
      }

      const patchRes = await fetch(
        `/api/crm/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ patientId }),
        },
      );
      if (!patchRes.ok) {
        // The card is saved; pressing again finds it by the number.
        throw new RailMessageError(t("createErrors.linkFailed"));
      }
      // What happened to the card's Telegram (audit TG-11): the thread's
      // account is written onto the card unless that would take it from
      // another card or overwrite the card's own account.
      const linked = (await patchRes.json().catch(() => null)) as {
        telegramLink?: TelegramLinkOutcome | null;
      } | null;
      return { id: patientId, reused, telegramLink: linked?.telegramLink ?? null };
    },
    onSuccess: ({ id, reused, telegramLink }) => {
      setOwnerConflict(null);
      toast.success(reused ? t("patientLinked") : t("patientCreated"));
      announceTelegramLink(telegramLink, t);
      // The card may have just learned the chat's Telegram: the rail must
      // not keep offering to bind it from a cached copy.
      void qc.invalidateQueries({ queryKey: ["patient-mini", id] });
      // Every list page and the thread opened by id (G6-07).
      invalidateConversationCaches(qc);
    },
    onError: (err) => {
      if (err instanceof PhoneOwnerMismatchError) {
        setOwnerConflict(err.owner);
        return;
      }
      toast.error(
        err instanceof RailMessageError ? err.message : t("createErrors.failed"),
      );
    },
  });

  return (
    <div className="space-y-4">
      {relink ? (
        <div className="space-y-1 px-1">
          <h3 className="text-[13px] font-bold text-foreground">
            {t("miniAppCardTitle")}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {t("miniAppCardDescription")}
          </p>
        </div>
      ) : (
        <EmptyState
          icon={<UserPlusIcon />}
          title={t("noPatientTitle")}
          description={t("noPatientDescription")}
        />
      )}
      <div className="space-y-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-name" className="text-xs">
            {t("fullNameLabel")}
          </Label>
          <Input
            id="tg-new-patient-name"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              setOwnerConflict(null);
            }}
            placeholder={t("fullNamePlaceholder")}
            autoComplete="off"
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tg-new-patient-phone" className="text-xs">
            {t("phoneLabel")}
          </Label>
          <Input
            id="tg-new-patient-phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/[^\d+\s()-]/g, ""));
              setOwnerConflict(null);
            }}
            placeholder="+998 ..."
            className="h-8"
          />
        </div>
        {ownerConflict ? (
          <PhoneOwnerPrompt
            owner={ownerConflict}
            pending={create.isPending}
            onAnswer={(answer) => create.mutate(answer)}
          />
        ) : null}
        <Button
          onClick={() => create.mutate(undefined)}
          disabled={
            create.isPending ||
            fullName.trim() === "" ||
            phone.trim() === "" ||
            ownerConflict !== null
          }
          size="sm"
          className="w-full"
        >
          {create.isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <UserPlusIcon className="size-3" />
          )}
          {relink ? t("linkToClinicCard") : t("createPatient")}
        </Button>
      </div>
    </div>
  );
}
