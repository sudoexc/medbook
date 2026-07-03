"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  ClockIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PhoneIcon,
  PlayIcon,
  RotateCcwIcon,
  UserCheckIcon,
  UserIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { AvatarWithStatus } from "@/components/atoms/avatar-with-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  useDoctorToday,
  type CurrentPatient,
  type PatientTag,
} from "../_hooks/use-doctor-today";
import { useAppointmentStatusMutation } from "../_hooks/use-appointment-status-mutation";

const TAG_LABEL_KEY: Record<PatientTag, string> = {
  active: "tags.active",
  first_visit: "tags.firstVisit",
  vip: "tags.vip",
  new: "tags.new",
};

const TAG_CLASS: Record<PatientTag, string> = {
  active: "bg-success/15 text-success",
  first_visit: "bg-violet/15 text-violet",
  vip: "bg-warning/15 text-warning",
  new: "bg-info/15 text-info",
};

function formatHHMMSS(totalSec: number) {
  const sign = totalSec < 0 ? "-" : "";
  const abs = Math.abs(totalSec);
  const h = String(Math.floor(abs / 3600)).padStart(2, "0");
  const m = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
  const s = String(abs % 60).padStart(2, "0");
  return `${sign}${h}:${m}:${s}`;
}

function formatVisitDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function formatHHMM(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** YYYY-MM-DD for today's local date — matches the schedule cache key. */
function todayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type CurrentSlice = {
  current: CurrentPatient | null;
  /** Two-lanes: true when `current` is the imminent-booking fallback. */
  implicitNext: boolean;
};

export function CurrentPatientCard() {
  const t = useTranslations("doctor.myDay");
  const { data, isLoading } = useDoctorToday<CurrentSlice>((d) => ({
    current: d.current,
    implicitNext: d.currentIsImplicitNext,
  }));
  const p = data?.current ?? null;

  if (isLoading) {
    return (
      <section className="flex flex-col rounded-2xl border border-border bg-card">
        <header className="px-5 pt-4 pb-2">
          <div className="text-[15px] font-semibold text-foreground">
            {t("current.title")}
          </div>
        </header>
        <div className="flex flex-col gap-3 px-5 pb-3">
          <div className="flex items-start gap-3">
            <Skeleton className="size-12 rounded-full" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      </section>
    );
  }

  if (!p) {
    return (
      <section className="flex flex-col rounded-2xl border border-border bg-card">
        <header className="px-5 pt-4 pb-2">
          <div className="text-[15px] font-semibold text-foreground">
            {t("current.title")}
          </div>
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserIcon className="size-5" />
          </div>
          <div className="text-sm font-medium text-foreground">
            {t("current.noneActive")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("current.noneActiveHint")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <ActivePatient patient={p} implicitNext={data?.implicitNext ?? false} />
  );
}

function ActivePatient({
  patient: p,
  implicitNext,
}: {
  patient: CurrentPatient;
  /**
   * Two-lanes model: the server flags when this "current" is just the next
   * booking within 15 min, not a visit the doctor actually picked. The card
   * then says «Следующая запись» + a pick hint instead of implying a visit
   * is underway — the doctor may equally well call a walk-in instead.
   */
  implicitNext: boolean;
}) {
  const t = useTranslations("doctor.myDay");
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "ru";
  const dateKey = React.useMemo(() => todayDateKey(), []);
  const mutation = useAppointmentStatusMutation(dateKey);

  // One global tick re-renders the timer every second; cheap because the
  // rest of the card is memoized through React's bailout on identical
  // props. The tick state *is* the clock — everything ("elapsed",
  // "until-start", etc.) derives from it locally on render.
  const [now, setNow] = React.useState<number>(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const startsAtMs = new Date(p.startsAt).getTime();
  const startedAtMs = p.startedAt ? new Date(p.startedAt).getTime() : null;

  let timer: {
    label: string;
    tone: "neutral" | "active" | "late";
  };
  if (p.status === "IN_PROGRESS" && startedAtMs) {
    const elapsedSec = Math.max(0, Math.floor((now - startedAtMs) / 1000));
    timer = {
      label: t("current.timerElapsed", { time: formatHHMMSS(elapsedSec) }),
      tone: "active",
    };
  } else if (p.status === "WAITING") {
    // Patient is in the waiting room. Show how long past scheduled start —
    // if doctor is on time it'll read "00:00:00", once they're late it
    // flips to the warn tone.
    const waitingSec = Math.max(0, Math.floor((now - startsAtMs) / 1000));
    timer = {
      label:
        waitingSec > 0
          ? t("current.timerWaiting", { time: formatHHMMSS(waitingSec) })
          : t("current.startsAt", { time: formatHHMM(p.startsAt) }),
      tone: waitingSec > 60 ? "late" : "neutral",
    };
  } else {
    // BOOKED imminent — countdown to scheduled start.
    const untilStartSec = Math.floor((startsAtMs - now) / 1000);
    timer = {
      label:
        untilStartSec > 0
          ? t("current.timerUntil", { time: formatHHMMSS(untilStartSec) })
          : t("current.startsAt", { time: formatHHMM(p.startsAt) }),
      tone: "neutral",
    };
  }

  const birthLabel = p.birthDate ? formatVisitDate(p.birthDate) : null;

  type StatusTarget = Parameters<typeof mutation.mutate>[0]["toStatus"];

  // Two-step clinic workflow surfaced as one rotating primary CTA:
  //   1. pre-visit   → «Начать приём» — the call branch stamps calledAt, fires
  //      the patient Telegram "вас вызывают", and moves straight to
  //      IN_PROGRESS in one write. Calling the patient in *is* starting the
  //      visit; there is no separate "call then start" step.
  //   2. IN_PROGRESS → «Завершить приём» (status → COMPLETED)
  type PrimaryAction =
    | { kind: "call" }
    | { kind: "status"; toStatus: StatusTarget };
  // CONFIRMED counts as pre-visit too: CRM bookings auto-confirm, so the
  // doctor's default starting point is CONFIRMED, not BOOKED.
  const isPreVisit =
    p.status === "BOOKED" ||
    p.status === "CONFIRMED" ||
    p.status === "WAITING";
  const primary: {
    label: string;
    Icon: typeof PlayIcon;
    action: PrimaryAction;
  } | null = (() => {
    if (isPreVisit) {
      return {
        label: t("current.startVisit"),
        Icon: PlayIcon,
        action: { kind: "call" },
      };
    }
    if (p.status === "IN_PROGRESS") {
      return {
        label: t("current.finishVisit"),
        Icon: CheckCircle2Icon,
        action: { kind: "status", toStatus: "COMPLETED" },
      };
    }
    return null;
  })();

  const fire = (toStatus: StatusTarget, opts?: { revert?: boolean }) =>
    mutation.mutate({
      appointmentId: p.appointmentId,
      toStatus,
      revert: opts?.revert,
    });

  const fireCall = () =>
    mutation.mutate({
      appointmentId: p.appointmentId,
      // toStatus is ignored in the call branch — sentinel kept to satisfy
      // the args type without leaking a separate mutation hook.
      toStatus: "WAITING",
      call: true,
    });

  const runPrimary = () => {
    if (!primary) return;
    if (primary.action.kind === "call") fireCall();
    else fire(primary.action.toStatus);
  };

  return (
    <section className="flex flex-col rounded-2xl border border-border bg-card">
      <header className="px-5 pt-4 pb-2">
        <div className="text-[15px] font-semibold text-foreground">
          {p.status === "IN_PROGRESS"
            ? t("current.currentVisit")
            : implicitNext
              ? t("current.nextBooking")
              : t("current.nextPatient")}
        </div>
        {implicitNext ? (
          <div className="mt-0.5 text-xs text-muted-foreground">
            {t("current.pickHint")}
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-3 px-5 pb-3">
        <div className="flex items-start gap-3">
          <AvatarWithStatus
            src={p.avatarUrl}
            name={p.fullName}
            size="lg"
            status={
              p.status === "IN_PROGRESS"
                ? "in-progress"
                : p.status === "WAITING"
                  ? "waiting"
                  : "confirmed"
            }
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold text-foreground">
              {p.fullName}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {p.age !== null ? t("current.ageYears", { count: p.age }) : "—"}
              {birthLabel ? ` (${birthLabel})` : ""}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <PhoneIcon className="size-3" />
              <span>{p.phone}</span>
            </div>
          </div>
        </div>

        {p.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {p.tags.map((tag) => (
              <span
                key={tag}
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  TAG_CLASS[tag],
                )}
              >
                {t(TAG_LABEL_KEY[tag])}
              </span>
            ))}
          </div>
        ) : null}

        {/* Formatted client-side: the server runs in UTC, so a server-built
            range string would be off by the clinic's UTC offset. */}
        <div className="text-xs text-muted-foreground">
          {formatHHMM(p.startsAt)} — {formatHHMM(p.endsAt)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className={cn(
              "inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums",
              timer.tone === "active" && "bg-success/15 text-success",
              timer.tone === "late" && "bg-warning/15 text-warning",
              timer.tone === "neutral" && "bg-primary/10 text-primary",
            )}
          >
            <ClockIcon className="size-3.5" />
            {timer.label}
          </div>
        </div>
      </div>

      {p.complaints ? (
        <div className="mx-5 rounded-xl border border-border bg-muted/30 px-3.5 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("current.complaints")}
          </div>
          <div className="mt-1 text-xs leading-relaxed text-foreground">
            {p.complaints}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 px-5 py-4">
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("current.lastVisit")}
          </div>
          {p.lastVisit ? (
            <>
              <div className="mt-1 text-sm font-semibold text-foreground tabular-nums">
                {formatVisitDate(p.lastVisit.date)}
              </div>
              <div className="text-xs text-muted-foreground">
                {p.lastVisit.title}
              </div>
              <Link
                href={`/${locale}/doctor/visits/${p.patientId}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                {t("current.openVisit")}
                <ChevronRightIcon className="size-3" />
              </Link>
            </>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("current.firstVisit")}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t("current.lastDiagnosis")}
          </div>
          {p.lastDiagnosis.codes.length > 0 ? (
            <>
              <ul className="mt-1 space-y-0.5 text-xs">
                {p.lastDiagnosis.codes.map((c) => (
                  <li key={c.code} className="flex gap-1.5">
                    <span className="font-semibold text-foreground tabular-nums">
                      {c.code}
                    </span>
                    <span className="truncate text-muted-foreground">
                      {c.name}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={`/${locale}/doctor/visits/${p.patientId}`}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
              >
                {t("current.viewHistory")}
                <ChevronRightIcon className="size-3" />
              </Link>
            </>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">
              {t("current.noData")}
            </div>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Link
          href={`/${locale}/doctor/patients/${p.patientId}`}
          className="motion-press inline-flex flex-1 items-center justify-center rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {t("current.openPatientCard")}
        </Link>
        {primary ? (
          <button
            type="button"
            onClick={runPrimary}
            disabled={mutation.isPending}
            className="motion-press inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <primary.Icon className="size-4" />
            )}
            {primary.label}
          </button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t("current.moreActions")}
              disabled={mutation.isPending}
              className="motion-press flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <MoreHorizontalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {p.status === "IN_PROGRESS" ? (
              <>
                <DropdownMenuItem
                  onSelect={() => fire("WAITING", { revert: true })}
                  className="gap-2"
                >
                  <RotateCcwIcon className="size-4" />
                  {t("current.stepBackWaiting")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {p.status === "WAITING" ? (
              <>
                <DropdownMenuItem
                  onSelect={() => fire("BOOKED", { revert: true })}
                  className="gap-2"
                >
                  <RotateCcwIcon className="size-4" />
                  {t("current.stepBackBooked")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            {p.status === "BOOKED" || p.status === "CONFIRMED" ? (
              <DropdownMenuItem
                onSelect={() => fire("WAITING")}
                className="gap-2"
              >
                <UserCheckIcon className="size-4" />
                {t("current.registerArrivalOnly")}
              </DropdownMenuItem>
            ) : null}
            {isPreVisit ? (
              <DropdownMenuItem
                onSelect={() => fire("NO_SHOW")}
                className="gap-2"
              >
                <UserXIcon className="size-4" />
                {t("current.noShow")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={() => fire("CANCELLED")}
              className="gap-2 text-destructive focus:text-destructive"
            >
              <XIcon className="size-4" />
              {t("current.cancelVisit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </footer>
    </section>
  );
}
