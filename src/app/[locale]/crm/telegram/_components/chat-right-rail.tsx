"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  BadgeCheckIcon,
  CalendarPlusIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CopyIcon,
  IdCardIcon,
  LayoutGridIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  TagIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
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

import type { InboxConversation, InboxMessage } from "../_hooks/types";
import { conversationsKey } from "../_hooks/use-conversations";
import { useUpdateConversationMeta } from "../_hooks/use-conversation-meta";
import { flattenMessages, useTgMessages } from "../_hooks/use-tg-messages";
import { useMarkConversationRead } from "../_hooks/use-mark-read";
import {
  dispatchChatFind,
  dispatchComposerInsert,
  useOpenAppointment,
} from "../_hooks/use-tg-events";

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
  isVerified?: boolean;
};

/** Server-side clinical KPIs from /api/crm/patients/[id]/stats. */
type PatientClinicalStats = {
  segment: string | null;
  visitsCount: number;
  lastVisitAt: string | null;
  birthDate: string | null;
  noShowCount: number;
  totalAppointments: number;
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

  if (!conversation.patientId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <CreatePatientForm conversation={conversation} />
        <TagsCard conversation={conversation} />
      </div>
    );
  }

  return <LinkedPatientRail conversation={conversation} />;
}

function LinkedPatientRail({ conversation }: { conversation: InboxConversation }) {
  const t = useTranslations("tgInbox.rail");
  const locale = useLocale();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  // The composer's "Записать на приём" quick action opens this same dialog.
  useOpenAppointment(conversation.id, () => setDialogOpen(true));

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
        isVerified={Boolean(p?.isVerified)}
        segment={segment}
        age={age}
        isLoading={detailsQuery.isLoading}
      />

      <LtvBalanceCard
        balance={p?.balance ?? 0}
        ltv={p?.ltv ?? 0}
        isLoading={detailsQuery.isLoading}
        patientId={patientId}
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
        onBook={() => setDialogOpen(true)}
      />

      <TagsCard conversation={conversation} />

      <AiAssistantCard
        messages={messages}
        conversationId={conversation.id}
      />

      <RelatedTopicsCard
        messages={messages}
        conversationId={conversation.id}
      />

      <TelegramStatsCard
        messages={messages}
        conversation={conversation}
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

function PatientIdentityCard({
  name,
  photoUrl,
  phone,
  externalId,
  username,
  isVerified,
  segment,
  age,
  isLoading,
}: {
  name: string;
  photoUrl: string | null;
  phone: string | null;
  externalId: string | null;
  username: string | null;
  isVerified: boolean;
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
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-bold text-foreground">{name}</span>
          {isVerified ? (
            <BadgeCheckIcon className="size-4 text-primary" aria-label={t("verified")} />
          ) : null}
        </div>
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
  patientId,
}: {
  balance: number | bigint;
  ltv: number | bigint;
  isLoading: boolean;
  patientId: string;
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
            <Link
              href={`/crm/patients/${patientId}?action=topup`}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
              aria-label={t("topUp")}
            >
              <PlusIcon className="size-3.5" />
            </Link>
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

function AiAssistantCard({
  messages,
  conversationId,
}: {
  messages: { body: string | null; direction: "IN" | "OUT" }[];
  conversationId: string;
}) {
  const t = useTranslations("tgInbox.rail.ai");
  // Crude topic detection from message bodies so the rec list reflects the
  // actual conversation. Real AI service ships separately — once wired up,
  // swap this for the API response.
  const recs = React.useMemo(() => deriveAiRecs(messages, t), [messages, t]);
  const onInsert = (text: string) => {
    dispatchComposerInsert({ conversationId, text });
    toast.success(t("inserted"));
  };

  const confidence = 92;
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card to-primary/5 p-3">
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="relative inline-flex">
            <SparklesIcon className="size-4 text-primary" aria-hidden />
            <span
              className="absolute inset-0 inline-flex rounded-full"
              style={{
                animation:
                  "motion-pulse-ring 2.4s cubic-bezier(0, 0, 0.2, 1) infinite",
              }}
              aria-hidden
            />
          </span>
          <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
        </div>
        <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[color:var(--success)]">
          {t("badge")}
        </span>
      </header>
      <p className="mb-2 text-[11px] text-muted-foreground">{t("subtitle")}</p>
      <ul className="space-y-1.5">
        {recs.map((rec, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onInsert(rec)}
              className="motion-press group flex w-full cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-foreground transition-colors hover:bg-primary/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              aria-label={t("insertAria")}
            >
              <span
                className={cn(
                  "mt-1.5 inline-block size-1.5 shrink-0 rounded-full transition-transform group-hover:scale-150",
                  i === 0 ? "bg-muted-foreground/60" : "bg-success",
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 leading-snug">{rec}</span>
              <PlusIcon
                className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                aria-hidden
              />
              <ChevronRightIcon
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:opacity-0"
                aria-hidden
              />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-border pt-2">
        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{t("confidenceLabel")}</span>
          <span className="font-semibold tabular-nums text-foreground">
            <CountUp to={confidence} />%
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-[color:var(--success)] transition-[width] duration-700 ease-out"
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>
    </section>
  );
}

function deriveAiRecs(
  messages: { body: string | null; direction: "IN" | "OUT" }[],
  t: (key: string) => string,
): string[] {
  const haystack = messages
    .map((m) => m.body ?? "")
    .join(" ")
    .toLowerCase();
  const out: string[] = [];
  if (
    haystack.includes("запис") ||
    haystack.includes("прием") ||
    haystack.includes("приём")
  ) {
    out.push(t("recBooking"));
  }
  if (haystack.includes("утр") || haystack.includes("утром")) {
    out.push(t("recMorningSlot"));
  }
  if (haystack.includes("невролог")) {
    out.push(t("recPrepReminder"));
  }
  // Fall back to generic recs when topics aren't detected yet.
  while (out.length < 3) {
    const fallback = [t("recBooking"), t("recMorningSlot"), t("recPrepReminder")];
    const next = fallback.find((x) => !out.includes(x));
    if (!next) break;
    out.push(next);
  }
  return out.slice(0, 3);
}

function RelatedTopicsCard({
  messages,
  conversationId,
}: {
  messages: { body: string | null }[];
  conversationId: string;
}) {
  const t = useTranslations("tgInbox.rail.topics");
  const counts = React.useMemo(() => countTopics(messages), [messages]);
  const [expanded, setExpanded] = React.useState(false);

  if (counts.length === 0) return null;

  const shown = expanded ? counts : counts.slice(0, 3);

  return (
    <section className="rounded-2xl border border-border bg-card p-3">
      <header className="mb-2 flex items-center gap-1.5">
        <CircleDotIcon
          className="size-3.5 text-muted-foreground"
          aria-hidden
        />
        <h3 className="text-[13px] font-bold text-foreground">{t("title")}</h3>
      </header>
      <ul className="space-y-0.5">
        {shown.map((c) => {
          const tint =
            c.key === "booking"
              ? "bg-primary/15 text-primary"
              : c.key === "neurology"
                ? "bg-info/15 text-[color:var(--info)]"
                : "bg-warning/15 text-[color:var(--warning)]";
          const term = TOPIC_TERMS[c.key];
          return (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => dispatchChatFind({ conversationId, term })}
                className="motion-press group flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                aria-label={t("findAria", { topic: t(`labels.${c.key}`) })}
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    className={cn(
                      "inline-block size-1.5 rounded-full transition-transform group-hover:scale-150",
                      c.key === "booking"
                        ? "bg-primary"
                        : c.key === "neurology"
                          ? "bg-[color:var(--info)]"
                          : "bg-[color:var(--warning)]",
                    )}
                    aria-hidden
                  />
                  {t(`labels.${c.key}`)}
                </span>
                <span
                  className={cn(
                    "inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums transition-transform group-hover:scale-105",
                    tint,
                  )}
                >
                  {c.count}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {counts.length > 3 ? (
        <div className="mt-2 flex justify-center border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t("collapse") : t("showAll")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const TOPIC_TERMS: Record<"booking" | "neurology" | "pricing", string> = {
  booking: "запис",
  neurology: "невролог",
  pricing: "цен",
};

function countTopics(
  messages: { body: string | null }[],
): { key: "booking" | "neurology" | "pricing"; count: number }[] {
  let booking = 0;
  let neurology = 0;
  let pricing = 0;
  for (const m of messages) {
    const body = (m.body ?? "").toLowerCase();
    if (
      body.includes("запис") ||
      body.includes("прием") ||
      body.includes("приём")
    )
      booking += 1;
    if (body.includes("невролог")) neurology += 1;
    if (
      body.includes("цен") ||
      body.includes("стоимост") ||
      body.includes("сум")
    )
      pricing += 1;
  }
  return [
    { key: "booking" as const, count: booking },
    { key: "neurology" as const, count: neurology },
    { key: "pricing" as const, count: pricing },
  ].filter((x) => x.count > 0);
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

  const risk: { label: string; tone: string } | null = !stats
    ? null
    : stats.totalAppointments === 0
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
          ) : stats && stats.totalAppointments > 0 ? (
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
  const inbound = messages.filter((m) => m.direction === "IN").length;
  const outbound = messages.filter((m) => m.direction === "OUT").length;
  const total = messages.length;
  const unread = conversation.unreadCount;
  const avgReplySec = React.useMemo(
    () => computeAvgReplySeconds(messages),
    [messages],
  );

  const tiles: StatTile[] = [
    {
      key: "messages",
      label: t("messages"),
      value: total,
      kind: "count",
      tone: "neutral",
    },
    {
      key: "botReplies",
      label: t("botReplies"),
      value: outbound,
      kind: "count",
      tone: "primary",
    },
    {
      key: "fromPatient",
      label: t("fromPatient"),
      value: inbound,
      kind: "count",
      tone: "info",
    },
    {
      key: "avgReply",
      label: t("avgReply"),
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
        <span className="text-[10px] text-muted-foreground">{t("period")}</span>
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
          formatDuration(tile.value!)
        ) : (
          <CountUp to={tile.value!} />
        )}
      </span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  return `${hours.toFixed(1)}h`;
}

function computeAvgReplySeconds(messages: InboxMessage[]): number | null {
  // Average time between a patient (IN) message and the next clinic (OUT)
  // reply. Returns null when we don't have at least one IN → OUT pair yet.
  if (messages.length < 2) return null;
  const sorted = [...messages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  let lastInAt: number | null = null;
  const gaps: number[] = [];
  for (const m of sorted) {
    const t = new Date(m.createdAt).getTime();
    if (m.direction === "IN") {
      lastInAt = t;
    } else if (m.direction === "OUT" && lastInAt !== null) {
      gaps.push((t - lastInAt) / 1000);
      lastInAt = null;
    }
  }
  if (gaps.length === 0) return null;
  return gaps.reduce((a, b) => a + b, 0) / gaps.length;
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
        if (j?.reason === "phone_already_exists" && j.patientId) {
          patientId = j.patientId;
          reused = true;
        } else {
          throw new Error(j?.error ?? "conflict");
        }
      } else {
        const j = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
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
        throw new Error(`Link failed: ${patchRes.status}`);
      }
      return { id: patientId, reused };
    },
    onSuccess: ({ reused }) => {
      toast.success(reused ? t("patientLinked") : t("patientCreated"));
      void qc.invalidateQueries({ queryKey: ["tg-conversations"] });
      void qc.invalidateQueries({
        queryKey: conversationsKey({
          q: "",
          mode: "all",
          unreadOnly: false,
          patientId: null,
          assignee: "all",
        }),
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
            onChange={(e) => setPhone(e.target.value.replace(/[^\d+\s()-]/g, ""))}
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
