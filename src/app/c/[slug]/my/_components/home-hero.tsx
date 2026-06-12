"use client";

/**
 * Wave 3a — state-first hero for the Mini App home (DESIGN-DOCTRINE П1-П3).
 *
 * One card answers the patient's question of the moment, resolved in
 * priority order:
 *
 *   queue (live)  →  in-progress  →  visit today  →  med due now
 *   →  fresh conclusion  →  next visit  →  calm-empty
 *
 * Queue numbers come from the public QR endpoint (`useQueueStatus`) — 20s
 * poll + `queue.updated` SSE invalidation, marked with a pulsing live dot.
 * Colour encodes status (П3): accent = info/today, salmon = you're next,
 * green = done/live, orange = medication due. One lower-priority state may
 * render as a slim secondary row so the screen never exceeds 3 CTAs (П11).
 */
import * as React from "react";
import Link from "next/link";
import {
  CalendarDays,
  Check,
  ChevronRight,
  ChevronUp,
  FileText,
  MapPin,
  Pill,
} from "lucide-react";

import { useT, useLang } from "./mini-i18n";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import {
  useAppointments,
  useCheckInAppointment,
  type MiniAppAppointment,
} from "../_hooks/use-appointments";
import { useActiveContext } from "../_hooks/use-active-context";
import {
  useMedications,
  useMarkReminder,
  type MedicationsReminder,
} from "../_hooks/use-medications";
import {
  useQueueStatus,
  type MiniAppQueueStatus,
} from "../_hooks/use-queue-status";
import { formatDateISO, formatTimeISO } from "./mini-ui";
import { MA_ACCENTS } from "./mini-app-tokens";
import { TicketSheet } from "./ticket-sheet";
import type { Dict } from "./mini-i18n";

const HOUR_MS = 3_600_000;
const GREEN = MA_ACCENTS.success;
const ORANGE = MA_ACCENTS.warning;
const SALMON = MA_ACCENTS.salmon;

function isSameLocalDay(iso: string, ref: Date): boolean {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}

function daysUntil(dateISO: string, now: number): number {
  const d = new Date(dateISO);
  d.setHours(0, 0, 0, 0);
  const n = new Date(now);
  n.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - n.getTime()) / 86_400_000);
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Status-tinted card surface that stays first-class in both themes (П14). */
function heroSurface(color: string): React.CSSProperties {
  return {
    backgroundColor: "var(--tg-section-bg)",
    backgroundImage: `linear-gradient(140deg, light-dark(color-mix(in oklch, ${color} 16%, var(--tg-section-bg)), color-mix(in oklch, ${color} 26%, var(--tg-section-bg))) 0%, var(--tg-section-bg) 72%)`,
    border: `1px solid light-dark(color-mix(in oklch, ${color} 26%, transparent), color-mix(in oklch, ${color} 36%, transparent))`,
    boxShadow: "var(--ma-card-shadow)",
    color: "var(--tg-text)",
  };
}

const chipStyle: React.CSSProperties = {
  backgroundColor: "color-mix(in oklch, var(--tg-hint) 14%, transparent)",
  color: "var(--tg-text)",
};

function LiveDot({ color = GREEN }: { color?: string }) {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span
        className="ma-ping absolute inline-flex h-full w-full rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    </span>
  );
}

function HeroCaption({
  label,
  color,
  live,
  right,
}: {
  label: string;
  color: string;
  live?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {live ? <LiveDot /> : null}
      <span
        className="text-[11px] font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </span>
      {right ? <span className="ml-auto">{right}</span> : null}
    </div>
  );
}

function DoctorRow({
  appt,
  lang,
  cabinet,
  t,
}: {
  appt: MiniAppAppointment;
  lang: "RU" | "UZ";
  cabinet?: string | null;
  t: Dict;
}) {
  const name = lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu;
  return (
    <div
      className="mt-3.5 flex items-center gap-2 text-xs"
      style={{ color: "var(--tg-hint)" }}
    >
      {cabinet ? (
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold"
          style={chipStyle}
        >
          {t.home.hero.cabinet.replace("{n}", cabinet)}
        </span>
      ) : null}
      <span className="truncate">{name}</span>
      <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
    </div>
  );
}

function QueueHero({
  appt,
  q,
  onOpenTicket,
}: {
  appt: MiniAppAppointment;
  q: MiniAppQueueStatus;
  onOpenTicket: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  const touchStart = React.useRef<{ x: number; y: number } | null>(null);
  const ahead = Math.max(0, q.position - 1);
  const isNext = ahead === 0;
  const color = isNext ? SALMON : "var(--tg-accent)";
  const aheadTemplate =
    lang === "RU"
      ? ruPlural(
          ahead,
          t.home.hero.aheadOne,
          t.home.hero.aheadFew,
          t.home.hero.aheadMany,
        )
      : t.home.hero.aheadOne;
  const etaFlavor =
    q.etaMinutes <= 5
      ? t.home.hero.etaShort
      : q.etaMinutes <= 25
        ? t.home.hero.etaMid
        : t.home.hero.etaLong;
  const open = () => {
    tg.haptic.selection();
    onOpenTicket();
  };
  return (
    <button
      type="button"
      onClick={open}
      onTouchStart={(e) => {
        touchStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }}
      onTouchMove={(e) => {
        if (!touchStart.current) return;
        const dy = e.touches[0].clientY - touchStart.current.y;
        const dx = Math.abs(e.touches[0].clientX - touchStart.current.x);
        // Swipe-up = open ticket; tap and text affordance duplicate it (П5).
        if (dy < -48 && dx < 40) {
          touchStart.current = null;
          open();
        }
      }}
      onTouchEnd={() => {
        touchStart.current = null;
      }}
      className="block w-full text-left"
    >
      <div
        className="ma-fade-in rounded-3xl p-5 ma-press active:scale-[0.99]"
        style={heroSurface(color)}
      >
        <HeroCaption
          label={t.home.hero.queueLabel}
          color={color}
          live
          right={
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums"
              style={chipStyle}
            >
              {t.home.hero.ticket.replace("{code}", q.ticketNumber)}
            </span>
          }
        />
        <div className="mt-2.5 text-[26px] font-extrabold leading-tight tracking-tight">
          {isNext
            ? t.home.hero.youAreNext
            : aheadTemplate.replace("{n}", String(ahead))}
        </div>
        <div className="mt-1 text-sm font-medium" style={{ color }}>
          {isNext
            ? t.home.hero.youAreNextHint
            : `${t.home.hero.etaWait.replace("{n}", String(q.etaMinutes))} · ${etaFlavor}`}
        </div>
        <DoctorRow
          appt={appt}
          lang={lang}
          cabinet={q.cabinet ?? appt.cabinet?.number ?? null}
          t={t}
        />
        <div
          className="mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold"
          style={{ color }}
        >
          <ChevronUp className="ma-nudge-up h-4 w-4" aria-hidden />
          {t.home.hero.swipeHint}
        </div>
      </div>
    </button>
  );
}

function InProgressHero({
  appt,
  cabinet,
  onOpenTicket,
}: {
  appt: MiniAppAppointment;
  cabinet: string | null;
  onOpenTicket: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  return (
    <button
      type="button"
      onClick={() => {
        tg.haptic.selection();
        onOpenTicket();
      }}
      className="block w-full text-left"
    >
      <div
        className="ma-fade-in rounded-3xl p-5 ma-press active:scale-[0.99]"
        style={heroSurface(GREEN)}
      >
        <HeroCaption label={t.home.hero.inProgressLabel} color={GREEN} live />
        <div className="mt-2.5 text-[26px] font-extrabold leading-tight tracking-tight">
          {t.home.hero.inProgressTitle}
        </div>
        <DoctorRow appt={appt} lang={lang} cabinet={cabinet} t={t} />
      </div>
    </button>
  );
}

function AppointmentHero({
  slug,
  appt,
  now,
}: {
  slug: string;
  appt: MiniAppAppointment;
  now: number;
}) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  const time = appt.time ?? formatTimeISO(appt.date);
  const diff = daysUntil(appt.date, now);
  const isToday = diff <= 0;
  const color = isToday ? "var(--tg-accent)" : "var(--tg-hint)";
  const title = isToday
    ? capitalize(t.home.todayAt.replace("{time}", time))
    : diff === 1
      ? capitalize(t.home.tomorrowAt.replace("{time}", time))
      : capitalize(t.home.inDays.replace("{n}", String(diff)));
  const spec =
    lang === "UZ" ? appt.doctor.specializationUz : appt.doctor.specializationRu;
  const { onBehalfOf } = useActiveContext();
  const checkin = useCheckInAppointment();
  // Wave 3c — «Я на месте». The server's arrivedAt is the source of truth
  // (survives Mini App restarts and is idempotent server-side);
  // sessionStorage only covers the optimistic gap until the appointments
  // query refetches.
  const [arrivedLocal, setArrivedLocal] = React.useState(false);
  React.useEffect(() => {
    try {
      setArrivedLocal(sessionStorage.getItem(`ma:arrived:${appt.id}`) === "1");
    } catch {
      /* sessionStorage unavailable — button stays tappable */
    }
  }, [appt.id]);
  const arrived = Boolean(appt.arrivedAt) || arrivedLocal;
  const onCheckIn = () => {
    tg.haptic.selection();
    checkin.mutate(
      { id: appt.id, onBehalfOf },
      {
        onSuccess: () => {
          tg.haptic.notification("success");
          setArrivedLocal(true);
          try {
            sessionStorage.setItem(`ma:arrived:${appt.id}`, "1");
          } catch {
            /* ignore */
          }
        },
        onError: () => {
          tg.haptic.notification("error");
          tg.showAlert(t.common.error);
        },
      },
    );
  };
  return (
    <>
    <Link
      href={`/c/${slug}/my/appointments`}
      onClick={() => tg.haptic.selection()}
      className="block"
    >
      <div
        className="ma-fade-in rounded-3xl p-5 ma-press active:scale-[0.99]"
        style={
          isToday
            ? heroSurface("var(--tg-accent)")
            : {
                backgroundColor: "var(--tg-section-bg)",
                border:
                  "1px solid color-mix(in oklch, var(--tg-hint) 18%, transparent)",
                boxShadow: "var(--ma-card-shadow)",
                color: "var(--tg-text)",
              }
        }
      >
        <HeroCaption
          label={isToday ? t.home.hero.todayLabel : t.home.hero.soonLabel}
          color={color}
        />
        <div className="mt-2.5 text-[26px] font-extrabold leading-tight tracking-tight">
          {title}
        </div>
        {!isToday ? (
          <div className="mt-1 text-sm font-medium" style={{ color: "var(--tg-hint)" }}>
            {formatDateISO(appt.date, lang)} · {time}
          </div>
        ) : (
          <div className="mt-1 truncate text-sm font-medium" style={{ color }}>
            {spec}
          </div>
        )}
        <DoctorRow
          appt={appt}
          lang={lang}
          cabinet={appt.cabinet?.number ?? null}
          t={t}
        />
      </div>
    </Link>
    {/* Sibling, not nested in the Link — interactive elements don't stack. */}
    {isToday ? (
      arrived ? (
        <div
          className="mt-2 flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold"
          style={{
            backgroundColor: `color-mix(in oklch, ${GREEN} 14%, transparent)`,
            color: GREEN,
          }}
        >
          <Check className="h-4 w-4" aria-hidden />
          {t.home.hero.checkinDone}
        </div>
      ) : (
        <button
          type="button"
          disabled={checkin.isPending}
          onClick={onCheckIn}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white ma-press active:scale-[0.98] disabled:opacity-60"
          style={{ backgroundColor: "var(--tg-accent)" }}
        >
          <MapPin className="h-4 w-4" aria-hidden />
          {t.home.hero.checkinCta}
        </button>
      )
    ) : null}
    </>
  );
}

function MedsHero({
  reminder,
  onBehalfOf,
}: {
  reminder: MedicationsReminder;
  onBehalfOf: string | null;
}) {
  const t = useT();
  const tg = useTelegramWebApp();
  const mark = useMarkReminder(onBehalfOf);
  return (
    <div className="ma-fade-in rounded-3xl p-5" style={heroSurface(ORANGE)}>
      <HeroCaption
        label={t.home.hero.medsLabel}
        color={ORANGE}
        right={<Pill className="h-4 w-4" style={{ color: ORANGE }} />}
      />
      <div className="mt-2.5 text-[22px] font-extrabold leading-tight tracking-tight">
        {t.home.hero.medsTitle.replace("{drug}", reminder.drugName)}
      </div>
      <div className="mt-1 text-sm font-medium" style={{ color: "var(--tg-hint)" }}>
        {t.home.hero.medsHint
          .replace("{dosage}", reminder.dosage)
          .replace("{time}", formatTimeISO(reminder.scheduledFor))}
      </div>
      <button
        type="button"
        disabled={mark.isPending}
        onClick={() => {
          tg.haptic.selection();
          mark.mutate(
            { id: reminder.id, action: "TAKEN" },
            {
              onSuccess: () => tg.haptic.notification("success"),
              onError: () => tg.haptic.notification("error"),
            },
          );
        }}
        className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white ma-press active:scale-[0.98] disabled:opacity-60"
        style={{ backgroundColor: GREEN }}
      >
        <Check className="h-4 w-4" />
        {t.medications.actions.taken}
      </button>
    </div>
  );
}

function ResultsHero({ slug, appt }: { slug: string; appt: MiniAppAppointment }) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  return (
    <Link
      href={`/c/${slug}/my/visit/${appt.id}`}
      onClick={() => tg.haptic.selection()}
      className="block"
    >
      <div
        className="ma-fade-in rounded-3xl p-5 ma-press active:scale-[0.99]"
        style={heroSurface(GREEN)}
      >
        <HeroCaption label={t.home.hero.resultsLabel} color={GREEN} />
        <div className="mt-2.5 text-[26px] font-extrabold leading-tight tracking-tight">
          {t.home.hero.resultsTitle}
        </div>
        <div
          className="mt-1 truncate text-sm font-medium"
          style={{ color: "var(--tg-hint)" }}
        >
          {(lang === "UZ" ? appt.doctor.nameUz : appt.doctor.nameRu) +
            " · " +
            formatDateISO(appt.date, lang)}
        </div>
        <div
          className="mt-3.5 flex items-center gap-2 text-xs"
          style={{ color: "var(--tg-hint)" }}
        >
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              backgroundColor: `color-mix(in oklch, ${GREEN} 14%, transparent)`,
              color: GREEN,
            }}
          >
            {t.documents.open}
          </span>
          <ChevronRight className="ml-auto h-4 w-4 shrink-0" />
        </div>
      </div>
    </Link>
  );
}

function EmptyHero() {
  const t = useT();
  return (
    <div
      className="ma-fade-in rounded-3xl p-5"
      style={{
        backgroundColor: "var(--tg-section-bg)",
        border:
          "1px solid color-mix(in oklch, var(--tg-hint) 18%, transparent)",
        boxShadow: "var(--ma-card-shadow)",
      }}
    >
      <div className="text-base font-semibold">{t.home.hero.emptyTitle}</div>
      <p
        className="mt-1 text-sm leading-relaxed"
        style={{ color: "var(--tg-hint)" }}
      >
        {t.home.hero.emptyHint}
      </p>
    </div>
  );
}

function SlimRow({
  href,
  icon: Icon,
  color,
  text,
  chip,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  text: string;
  chip?: string;
}) {
  const tg = useTelegramWebApp();
  return (
    <Link
      href={href}
      onClick={() => tg.haptic.selection()}
      className="flex items-center gap-3 rounded-2xl px-3.5 py-2.5 ma-press active:scale-[0.99]"
      style={{
        backgroundColor: "var(--tg-section-bg)",
        boxShadow: "var(--ma-card-shadow)",
        color: "var(--tg-text)",
      }}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
        style={{
          backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
          color,
        }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {text}
      </span>
      {chip ? (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={chipStyle}
        >
          {chip}
        </span>
      ) : null}
      <ChevronRight
        className="h-4 w-4 shrink-0"
        style={{ color: "var(--tg-hint)" }}
      />
    </Link>
  );
}

export function HomeHero({
  slug,
  animate,
}: {
  slug: string;
  animate: boolean;
}) {
  const t = useT();
  const lang = useLang();
  const { onBehalfOf } = useActiveContext();
  const upcoming = useAppointments("upcoming", onBehalfOf);
  const past = useAppointments("past", onBehalfOf);
  const meds = useMedications(onBehalfOf);
  // Frozen per mount — react-hooks/purity forbids Date.now() in render.
  const [now] = React.useState(() => Date.now());
  const nowDate = React.useMemo(() => new Date(now), [now]);
  const [ticketOpen, setTicketOpen] = React.useState(false);
  const openTicket = React.useCallback(() => setTicketOpen(true), []);

  const queueAppt =
    upcoming.data?.find(
      (a) =>
        isSameLocalDay(a.date, nowDate) &&
        (a.status === "WAITING" || a.status === "IN_PROGRESS"),
    ) ?? null;
  const queue = useQueueStatus(queueAppt ? queueAppt.id : null);

  const todayAppt =
    upcoming.data?.find(
      (a) =>
        isSameLocalDay(a.date, nowDate) &&
        (a.status === "BOOKED" || a.status === "CONFIRMED"),
    ) ?? null;
  const nextUpcoming = upcoming.data?.[0] ?? null;

  const dueReminder = React.useMemo(() => {
    const list = meds.data?.reminders ?? [];
    return (
      list
        .filter(
          (r) =>
            r.status === "PENDING" ||
            (r.status === "SNOOZED" &&
              r.snoozeUntil != null &&
              new Date(r.snoozeUntil).getTime() <= now),
        )
        .sort(
          (a, b) =>
            new Date(a.scheduledFor).getTime() -
            new Date(b.scheduledFor).getTime(),
        )[0] ?? null
    );
  }, [meds.data, now]);

  const freshConclusion = React.useMemo(
    () =>
      past.data?.find(
        (a) =>
          a.status === "COMPLETED" &&
          !!a.conclusionUrl &&
          now - new Date(a.date).getTime() < 72 * HOUR_MS,
      ) ?? null,
    [past.data, now],
  );

  const wrapperClass = animate ? "ma-fade-up mb-5" : "mb-5";
  const wrapperStyle = animate
    ? ({ animationDelay: "40ms" } as React.CSSProperties)
    : undefined;

  // Same-geometry skeleton — no layout jump when data lands (П7).
  if (upcoming.isLoading || (queueAppt !== null && queue.isLoading)) {
    return (
      <div className={wrapperClass} style={wrapperStyle}>
        <div
          className="ma-skeleton rounded-3xl"
          style={{ height: 148, animationDuration: "1.6s" }}
        />
      </div>
    );
  }

  type Primary =
    | "queue"
    | "inprogress"
    | "today"
    | "meds"
    | "results"
    | "soon"
    | "empty";

  let primary: Primary;
  if (queueAppt && queue.data?.status === "WAITING") primary = "queue";
  else if (
    queueAppt &&
    (queue.data?.status === "IN_PROGRESS" ||
      (!queue.data && queueAppt.status === "IN_PROGRESS"))
  )
    primary = "inprogress";
  else if (queueAppt || todayAppt) primary = "today";
  else if (dueReminder) primary = "meds";
  else if (freshConclusion) primary = "results";
  else if (nextUpcoming) primary = "soon";
  else primary = "empty";

  let hero: React.ReactNode;
  switch (primary) {
    case "queue":
      hero = (
        <QueueHero appt={queueAppt!} q={queue.data!} onOpenTicket={openTicket} />
      );
      break;
    case "inprogress":
      hero = (
        <InProgressHero
          appt={queueAppt!}
          cabinet={queue.data?.cabinet ?? queueAppt!.cabinet?.number ?? null}
          onOpenTicket={openTicket}
        />
      );
      break;
    case "today":
      hero = (
        <AppointmentHero
          slug={slug}
          appt={(queueAppt ?? todayAppt)!}
          now={now}
        />
      );
      break;
    case "meds":
      hero = <MedsHero reminder={dueReminder!} onBehalfOf={onBehalfOf} />;
      break;
    case "results":
      hero = <ResultsHero slug={slug} appt={freshConclusion!} />;
      break;
    case "soon":
      hero = <AppointmentHero slug={slug} appt={nextUpcoming!} now={now} />;
      break;
    default:
      hero = <EmptyHero />;
  }

  // One slim secondary row max (П11): the most useful state that lost the
  // priority battle.
  let secondary: React.ReactNode = null;
  if (primary !== "meds" && primary !== "empty" && dueReminder) {
    secondary = (
      <SlimRow
        href={`/c/${slug}/my/medications`}
        icon={Pill}
        color={ORANGE}
        text={reminderRowText(dueReminder, t)}
        chip={formatTimeISO(dueReminder.scheduledFor)}
      />
    );
  } else if (
    (primary === "meds" || primary === "results") &&
    nextUpcoming !== null
  ) {
    const time = nextUpcoming.time ?? formatTimeISO(nextUpcoming.date);
    const diff = daysUntil(nextUpcoming.date, now);
    const chip =
      diff <= 0
        ? t.home.todayAt.replace("{time}", time)
        : diff === 1
          ? t.home.tomorrowAt.replace("{time}", time)
          : t.home.inDays.replace("{n}", String(diff));
    secondary = (
      <SlimRow
        href={`/c/${slug}/my/appointments`}
        icon={CalendarDays}
        color="var(--tg-accent)"
        text={
          lang === "UZ"
            ? nextUpcoming.doctor.nameUz
            : nextUpcoming.doctor.nameRu
        }
        chip={chip}
      />
    );
  } else if (primary !== "results" && freshConclusion) {
    secondary = (
      <SlimRow
        href={`/c/${slug}/my/visit/${freshConclusion.id}`}
        icon={FileText}
        color={GREEN}
        text={t.home.hero.resultsTitle}
      />
    );
  }

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      {hero}
      {secondary ? <div className="mt-2">{secondary}</div> : null}
      {ticketOpen && queueAppt ? (
        <TicketSheet appt={queueAppt} onClose={() => setTicketOpen(false)} />
      ) : null}
    </div>
  );
}

function reminderRowText(r: MedicationsReminder, t: Dict): string {
  return t.home.hero.medsTitle.replace("{drug}", r.drugName);
}
