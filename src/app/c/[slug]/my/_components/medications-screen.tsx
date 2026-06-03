"use client";

/**
 * Phase 16 Wave 3 — Medications dashboard (Mini App).
 *
 * Two stacked sections:
 *   1. **Open reminders** — `MedicationReminderSend` rows in PENDING (or
 *      SNOOZED-and-elapsed) state. Each card has three actions:
 *        - "Принял" → POST `{ action: "TAKEN" }`
 *        - "Пропустил" → POST `{ action: "SKIPPED" }`
 *        - "Отложить на 30 мин" → POST `{ action: "SNOOZED", snoozeMinutes: 30 }`
 *   2. **Schedule** — every ACTIVE/PAUSED prescription with the next dose
 *      time (computed server-side in clinic TZ via `nextTickAt`) and how
 *      many days remain on the course.
 *
 * If the clinic has `medicationRemindersEnabled = false`, we still render
 * the schedule so the patient can see what's prescribed — only the
 * reminder push side is dark.
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MButton,
  MCard,
  MEmpty,
  MSection,
} from "./mini-ui";
import { SkeletonList } from "./skeleton";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useActiveContext } from "../_hooks/use-active-context";
import {
  useMarkReminder,
  useMedications,
  type MedicationsPrescription,
  type MedicationsReminder,
} from "../_hooks/use-medications";

function formatLocalTime(iso: string, lang: "RU" | "UZ", tz: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(d);
  } catch {
    return iso.slice(11, 16);
  }
}

function formatLocalDate(iso: string, lang: "RU" | "UZ", tz: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(lang === "UZ" ? "uz-Latn-UZ" : "ru-RU", {
      day: "2-digit",
      month: "short",
      timeZone: tz,
    }).format(d);
  } catch {
    return iso.slice(0, 10);
  }
}

function ReminderCard({
  reminder,
  tz,
  onMark,
  pending,
}: {
  reminder: MedicationsReminder;
  tz: string;
  onMark: (action: "TAKEN" | "SKIPPED" | "SNOOZED") => void;
  pending: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const time = formatLocalTime(reminder.scheduledFor, lang, tz);
  const date = formatLocalDate(reminder.scheduledFor, lang, tz);
  const isSnoozed = reminder.status === "SNOOZED";
  return (
    <MCard className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">{reminder.drugName}</div>
          <div className="text-sm" style={{ color: "var(--tg-hint)" }}>
            {reminder.dosage} · {date} {time}
          </div>
        </div>
        {isSnoozed && (
          <span
            className="rounded-full px-2 py-0.5 text-xs"
            style={{
              backgroundColor:
                "color-mix(in oklch, var(--tg-accent) 15%, transparent)",
              color: "var(--tg-accent)",
            }}
          >
            {t.medications.snoozedBadge}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <MButton
          variant="primary"
          disabled={pending}
          onClick={() => onMark("TAKEN")}
        >
          {t.medications.actions.taken}
        </MButton>
        <MButton
          variant="secondary"
          disabled={pending}
          onClick={() => onMark("SKIPPED")}
        >
          {t.medications.actions.skipped}
        </MButton>
        <MButton
          variant="ghost"
          disabled={pending}
          onClick={() => onMark("SNOOZED")}
        >
          {t.medications.actions.snooze}
        </MButton>
      </div>
    </MCard>
  );
}

function ScheduleRow({
  rx,
  tz,
}: {
  rx: MedicationsPrescription;
  tz: string;
}) {
  const t = useT();
  const lang = useLang();
  const isPaused = rx.status === "PAUSED";
  return (
    <MCard className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold">
            {rx.drugName}
            {isPaused && (
              <span
                className="ml-2 rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor:
                    "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
                  color: "var(--tg-hint)",
                }}
              >
                {t.medications.statusPaused}
              </span>
            )}
          </div>
          <div className="text-sm" style={{ color: "var(--tg-hint)" }}>
            {rx.dosage}
          </div>
        </div>
        {rx.daysRemaining != null && (
          <span className="text-xs" style={{ color: "var(--tg-hint)" }}>
            {t.medications.daysLeft.replace("{n}", String(rx.daysRemaining))}
          </span>
        )}
      </div>
      <div className="text-sm" style={{ color: "var(--tg-hint)" }}>
        {(rx.schedule.times ?? []).join(" · ") || "—"}
      </div>
      {rx.nextDoseAt && (
        <div className="text-xs" style={{ color: "var(--tg-accent)" }}>
          {t.medications.nextDose
            .replace("{date}", formatLocalDate(rx.nextDoseAt, lang, tz))
            .replace("{time}", formatLocalTime(rx.nextDoseAt, lang, tz))}
        </div>
      )}
      {rx.notes && (
        <div className="text-sm" style={{ color: "var(--tg-text)" }}>
          {rx.notes}
        </div>
      )}
    </MCard>
  );
}

export function MedicationsScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const { onBehalfOf } = useActiveContext();

  const query = useMedications(onBehalfOf);
  const mark = useMarkReminder(onBehalfOf);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  const onMark = React.useCallback(
    async (id: string, action: "TAKEN" | "SKIPPED" | "SNOOZED") => {
      setPendingId(id);
      try {
        await mark.mutateAsync({
          id,
          action,
          snoozeMinutes: action === "SNOOZED" ? 30 : undefined,
        });
        tg.haptic.notification("success");
      } catch {
        tg.haptic.notification("error");
      } finally {
        setPendingId(null);
      }
    },
    [mark, tg],
  );

  if (query.isLoading) return <SkeletonList rows={4} variant="card" />;
  if (query.isError || !query.data) return <MEmpty>{t.common.error}</MEmpty>;

  const data = query.data;
  const tz = data.timezone || "Asia/Tashkent";
  const reminders = data.reminders ?? [];
  const prescriptions = data.prescriptions ?? [];

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.medications.title}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.medications.subtitle}
      </p>

      {!data.medicationRemindersEnabled && (
        <MCard className="mb-4 text-sm" style={{ color: "var(--tg-hint)" }}>
          {t.medications.disabledNotice}
        </MCard>
      )}

      {reminders.length > 0 && (
        <MSection title={t.medications.openTitle}>
          <div className="space-y-3">
            {reminders.map((r) => (
              <ReminderCard
                key={r.id}
                reminder={r}
                tz={tz}
                pending={pendingId === r.id || mark.isPending}
                onMark={(action) => onMark(r.id, action)}
              />
            ))}
          </div>
        </MSection>
      )}

      <MSection title={t.medications.scheduleTitle}>
        {prescriptions.length === 0 ? (
          <MEmpty>{t.medications.empty}</MEmpty>
        ) : (
          <div className="space-y-3">
            {prescriptions.map((rx) => (
              <ScheduleRow key={rx.id} rx={rx} tz={tz} />
            ))}
          </div>
        )}
      </MSection>
    </div>
  );
}
