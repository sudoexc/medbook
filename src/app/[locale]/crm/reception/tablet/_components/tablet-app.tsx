"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  ArrowLeftIcon,
  BrainIcon,
  CalendarClockIcon,
  CheckIcon,
  LogOutIcon,
  RefreshCwIcon,
  TicketPlusIcon,
  UsersIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Link } from "@/i18n/navigation";
import { formatCalendarDay, formatDate } from "@/lib/format";
import {
  conflictReasonText,
  type ConflictTranslator,
} from "@/lib/appointments/conflict-message";
import type { LifecycleRole } from "@/lib/appointments/lifecycle";
import { PhoneOwnerMismatchError } from "@/components/appointments/phone-owner-prompt";
import { useCurrentRole } from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";
import {
  arrivalsFor,
  liveWaitingCount,
  orderTabletDoctors,
  type TabletApptRow,
} from "@/lib/reception-tablet/doctor-day";
import {
  flowReducer,
  HOME,
  headerBack,
  stepNumber,
  stepsFor,
  canOpenStep,
  isStepComplete,
  type ActiveFlow,
  type FlowStep,
  type TabletMode,
} from "@/lib/reception-tablet/flow";
import {
  BookingUnsureError,
  isNetworkError,
  TabletWriteError,
  type WriteFailure,
} from "@/lib/reception-tablet/errors";
import { nameWithoutYear } from "@/lib/reception-tablet/new-patient";

import {
  useMinuteClock,
  useOnline,
  useSlowFlag,
  useTabletData,
  useTabletLive,
  type TabletData,
  type TabletDoctor,
} from "../_hooks/use-tablet-data";
import {
  useBookVisit,
  useDoctorServices,
  useIssueWalkin,
  useSubmitLock,
} from "../_hooks/use-tablet-actions";
import { ArrivalsList } from "./arrivals-list";
import { ConfirmStep, OwnerQuestionCard } from "./confirm-step";
import { DoctorStep } from "./doctor-step";
import { DoctorTile } from "./doctor-tile";
import { BookingDone, TicketDone } from "./done-screen";
import { EMPTY_PATIENT_SEARCH, PatientStep, type PatientSearchState } from "./patient-step";
import { TimeStep } from "./time-step";
import { ErrorNote, Segmented, TOUCH, TouchButton } from "./tablet-ui";

/** A flow left untouched this long goes back home, ready for the next patient. */
const IDLE_RESET_MS = 5 * 60_000;

type SubmitFailure = WriteFailure | { kind: "network" } | { kind: "bookingUnsure" };

/**
 * `/crm/reception/tablet`: the reception on the clinic's iPad (12.9", touch
 * only), carried around the clinic. One screen at a time, big targets, the
 * desk's own APIs underneath. Covers the CRM shell edge to edge so the
 * sidebar and the top bar take no room and catch no stray taps.
 */
export function TabletApp() {
  const tRoot = useTranslations("receptionTablet");
  const locale = useLocale();
  useTabletLive();
  const now = useMinuteClock();
  const online = useOnline();
  const data = useTabletData(now);
  const role = useCurrentRole() as LifecycleRole;

  const [flow, dispatch] = React.useReducer(flowReducer, HOME);
  const [search, setSearch] = React.useState<PatientSearchState>(EMPTY_PATIENT_SEARCH);
  const [showAll, setShowAll] = React.useState(false);
  const [homeTab, setHomeTab] = React.useState<"doctors" | "arrivals">("doctors");
  const [failure, setFailure] = React.useState<SubmitFailure | null>(null);

  const issue = useIssueWalkin();
  const book = useBookVisit();
  const lock = useSubmitLock();
  const pending = issue.isPending || book.isPending;
  const slow = useSlowFlag(pending);

  const doctorById = React.useMemo(
    () => new Map(data.doctors.map((d) => [d.id, d] as const)),
    [data.doctors],
  );
  const rows = data.rows as unknown as TabletApptRow[];

  const active: ActiveFlow | null = flow.screen === "flow" ? flow : null;
  const services = useDoctorServices(active?.doctorId ?? null);

  // The current flow's id. Bumped whenever a flow ends (home, a new start,
  // the page closing): a server answer stamped with an older id is not for
  // the screen now showing.
  const flowSeq = React.useRef(0);
  React.useEffect(
    () => () => {
      flowSeq.current += 1;
    },
    [],
  );

  const goHome = React.useCallback(() => {
    flowSeq.current += 1;
    dispatch({ type: "home" });
    setSearch(EMPTY_PATIENT_SEARCH);
    setFailure(null);
  }, []);

  const start = (mode: TabletMode, doctorId?: string) => {
    flowSeq.current += 1;
    setSearch(EMPTY_PATIENT_SEARCH);
    setFailure(null);
    dispatch({
      type: "start",
      mode,
      doctorId: doctorId ?? null,
      today: data.today,
      flowId: flowSeq.current,
    });
  };

  // The header's «Назад» on the new patient form goes back to the search.
  const onHeaderBack = () => {
    if (!active) return;
    if (headerBack(active, { creatingPatient: search.creating }) === "closeNewPatient") {
      setSearch({ ...search, creating: false });
      return;
    }
    dispatch({ type: "back" });
  };

  // A refusal belongs to the screen it was shown on.
  const step = active?.step ?? null;
  React.useEffect(() => setFailure(null), [step]);

  // Each step opens at its top.
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [flow.screen, step]);

  // An abandoned flow does not wait for the next person with someone
  // else's name on it.
  React.useEffect(() => {
    if (flow.screen === "home" || pending) return;
    let timer = window.setTimeout(goHome, IDLE_RESET_MS);
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(goHome, IDLE_RESET_MS);
    };
    window.addEventListener("pointerdown", bump, { passive: true });
    window.addEventListener("keydown", bump);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, [flow.screen, pending, goHome]);

  const isCurrentFlow = (flowId: number) => flowSeq.current === flowId;

  const onSubmitError = (flowId: number, patientName: string) => (e: unknown) => {
    if (!isCurrentFlow(flowId)) {
      // The flow is gone; only a booking that may have been saved is worth
      // a word, so nobody books that person again blind.
      if (e instanceof BookingUnsureError) toast.warning(tRoot("late.unsure", { name: patientName }));
      return;
    }
    if (e instanceof PhoneOwnerMismatchError) {
      dispatch({ type: "ownerQuestion", owner: e.owner, flowId });
      return;
    }
    if (e instanceof BookingUnsureError) {
      dispatch({ type: "bookingUnsure", unsure: e.unsure, flowId });
      setFailure({ kind: "bookingUnsure" });
    } else if (e instanceof TabletWriteError) setFailure(e.failure);
    else if (isNetworkError(e) || !navigator.onLine) setFailure({ kind: "network" });
    else setFailure({ kind: "failed" });
  };

  const submit = (phoneOwner?: "same" | "other") => {
    if (!active || !active.patient || !active.doctorId) return;
    const { flowId, patient, doctorId, serviceId } = active;
    const patientName = nameWithoutYear(patient.fullName);
    setFailure(null);
    if (active.mode === "queue") {
      const placeHint = liveWaitingCount(rows, doctorId);
      lock(() =>
        issue.mutateAsync({ patient, doctorId, serviceId, phoneOwner }).then((r) => {
          if (!isCurrentFlow(flowId)) {
            // Issued after all, for a flow already left: the number must
            // still reach the desk, or a ticket sits in a queue unknown.
            toast.success(
              tRoot("late.ticket", { number: r.ticketNumber, name: r.patient.fullName }),
              { duration: 30_000 },
            );
            return;
          }
          dispatch({
            type: "done",
            flowId,
            result: {
              kind: "ticket",
              appointmentId: r.appointmentId,
              ticketNumber: r.ticketNumber,
              ticketCode: r.ticketCode ?? null,
              duplicate: r.duplicate === true,
              patientName: r.patient.fullName,
              doctorId: r.doctor.id,
              cabinet: r.cabinet,
              placeHint: r.duplicate ? null : placeHint,
            },
          });
        }, onSubmitError(flowId, patientName)),
      );
      return;
    }
    const { day, time, createdPatientId, unsureBooking } = active;
    if (!day || !time) return;
    const serviceMin = serviceId
      ? (services.data?.find((s) => s.id === serviceId)?.durationMin ?? null)
      : null;
    lock(() =>
      book
        .mutateAsync({
          patient,
          unsure: unsureBooking,
          createdPatientId,
          doctorId,
          serviceId,
          serviceMin,
          day,
          time,
          phoneOwner,
          onPatientCreated: (patientId) => dispatch({ type: "patientCreated", patientId, flowId }),
        })
        .then((r) => {
          if (!isCurrentFlow(flowId)) {
            const when = `${formatCalendarDay(`${r.day}T12:00:00+05:00`, locale, { month: "long" })}, ${r.time}`;
            toast.success(tRoot("late.booking", { name: patientName, when }), { duration: 30_000 });
            return;
          }
          dispatch({
            type: "done",
            flowId,
            result: {
              kind: "booking",
              appointmentId: r.id,
              patientName,
              // As saved: a booking found after a lost answer keeps the
              // doctor, day and time it was made for.
              doctorId: r.doctorId,
              day: r.day,
              time: r.time,
              recovered: r.recovered,
            },
          });
        }, onSubmitError(flowId, patientName)),
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-surface text-[17px] leading-normal text-foreground [-webkit-tap-highlight-color:transparent]"
      style={{
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <TopBar now={now} online={online} updatedAt={data.updatedAt} locked={pending} />
      {!online ? <OfflineBanner /> : null}

      {active ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {active.step !== "done" ? (
            <FlowHeader
              flow={active}
              locked={pending}
              onBack={onHeaderBack}
              onCancel={goHome}
              onGoTo={(s) => dispatch({ type: "goTo", step: s })}
            />
          ) : null}
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6"
          >
            <FlowBody
              flow={active}
              data={{ ...data, rows }}
              doctorById={doctorById}
              search={search}
              onSearchChange={setSearch}
              showAll={showAll}
              onShowAllChange={setShowAll}
              dispatch={dispatch}
              failure={failure}
              pending={pending}
              onOwnerAnswer={(a) => submit(a)}
              onNext={goHome}
            />
          </div>
          {active.step === "confirm" ? (
            <BottomBar>
              {slow ? (
                <p role="status" className="mb-3 text-center text-[15px] text-muted-foreground">
                  {tRoot("slow")}
                </p>
              ) : null}
              <ConfirmActions
                flow={active}
                pending={pending}
                online={online}
                onBack={() => dispatch({ type: "back" })}
                onSubmit={() => submit()}
              />
            </BottomBar>
          ) : null}
        </div>
      ) : (
        <Home
          data={{ ...data, rows }}
          role={role}
          now={now}
          online={online}
          showAll={showAll}
          onShowAllChange={setShowAll}
          tab={homeTab}
          onTabChange={setHomeTab}
          doctorById={doctorById}
          onStart={start}
          scrollRef={scrollRef}
        />
      )}
    </div>
  );
}

function TopBar({
  now,
  online,
  updatedAt,
  locked,
}: {
  now: Date;
  online: boolean;
  updatedAt: number;
  /** A write is out: leaving now would lose its answer. */
  locked: boolean;
}) {
  const t = useTranslations("receptionTablet");
  const locale = useLocale();
  const lang = locale === "uz" ? "uz" : "ru";
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-border bg-card px-6 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary dark:bg-primary/20">
        <BrainIcon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-xl font-bold leading-tight text-foreground">{t("title")}</p>
        {/* The server renders a moment earlier than the iPad hydrates. */}
        <p className="truncate text-[15px] text-muted-foreground" suppressHydrationWarning>
          {formatCalendarDay(now, locale, { month: "long", weekday: true })}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-4">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[15px] font-semibold",
            online ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
          )}
        >
          {online ? (
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-success" />
            </span>
          ) : (
            <WifiOffIcon className="size-4" aria-hidden />
          )}
          {online ? t("online") : t("offline")}
        </span>
        {updatedAt > 0 ? (
          <span className="hidden text-[15px] text-muted-foreground md:inline">
            {t("updatedAt", { time: formatDate(updatedAt, lang, "time") })}
          </span>
        ) : null}
        <span className="text-3xl font-bold tabular-nums text-foreground" suppressHydrationWarning>
          {formatDate(now, lang, "time")}
        </span>
        <Link
          href="/crm/reception"
          aria-disabled={locked || undefined}
          tabIndex={locked ? -1 : undefined}
          onClick={(e) => {
            if (locked) e.preventDefault();
          }}
          className={cn(
            TOUCH,
            "motion-press inline-flex h-14 items-center gap-2 rounded-2xl border border-border bg-card px-5 text-[17px] font-semibold text-foreground active:bg-muted",
            locked && "pointer-events-none opacity-50",
          )}
        >
          <LogOutIcon className="size-5" aria-hidden />
          <span className="hidden sm:inline">{t("exit")}</span>
        </Link>
      </div>
    </header>
  );
}

function OfflineBanner() {
  const t = useTranslations("receptionTablet");
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-destructive/30 bg-destructive/10 px-6 py-3 text-[17px] font-medium text-destructive"
    >
      <WifiOffIcon className="size-5 shrink-0" aria-hidden />
      {t("offlineBanner")}
    </div>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-6 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {children}
    </div>
  );
}

type HomeData = Omit<TabletData, "rows"> & { rows: TabletApptRow[] };

function Home({
  data,
  role,
  now,
  online,
  showAll,
  onShowAllChange,
  tab,
  onTabChange,
  doctorById,
  onStart,
  scrollRef,
}: {
  data: HomeData;
  role: LifecycleRole;
  now: Date;
  online: boolean;
  showAll: boolean;
  onShowAllChange: (v: boolean) => void;
  tab: "doctors" | "arrivals";
  onTabChange: (v: "doctors" | "arrivals") => void;
  doctorById: Map<string, TabletDoctor>;
  onStart: (mode: TabletMode, doctorId?: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations("receptionTablet.home");
  const doctors = React.useMemo(
    () => orderTabletDoctors(data.doctors, data.summaries, { showAll }),
    [data.doctors, data.summaries, showAll],
  );
  const onDutyCount = React.useMemo(
    () => data.doctors.filter((d) => data.summaries.get(d.id)?.onDuty).length,
    [data.doctors, data.summaries],
  );
  const arrivals = React.useMemo(() => arrivalsFor(data.rows, role, now), [data.rows, role, now]);
  const hasBookingsToday = React.useMemo(
    () => data.rows.some((r) => r.channel !== "WALKIN"),
    [data.rows],
  );

  const count = (n: number) => (
    <span className="rounded-full bg-muted px-2 text-[15px] font-bold tabular-nums text-muted-foreground">
      {n}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <Segmented
          className="mb-6 xl:hidden"
          label={t("doctorsTitle")}
          value={tab}
          onChange={(v) => v && onTabChange(v)}
          options={[
            { value: "doctors", label: <>{t("doctorsTitle")} {count(onDutyCount)}</> },
            { value: "arrivals", label: <>{t("arrivalsTitle")} {count(arrivals.length)}</> },
          ]}
        />

        {data.isError ? (
          <ErrorNote
            className="mb-6"
            action={
              <TouchButton tone="outline" onClick={data.refetch}>
                <RefreshCwIcon />
                {t("retry")}
              </TouchButton>
            }
          >
            <span className="font-semibold">{t("loadError")}.</span> {t("loadErrorBody")}
          </ErrorNote>
        ) : null}

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_27rem]">
          <section
            aria-label={t("doctorsTitle")}
            className={cn("flex-col gap-4", tab === "doctors" ? "flex" : "hidden xl:flex")}
          >
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="mr-auto text-2xl font-bold text-foreground">
                {t("doctorsTitle")}{" "}
                <span className="font-semibold text-muted-foreground">
                  {t("doctorsCount", { count: onDutyCount })}
                </span>
              </h2>
              <TouchButton tone="ghost" onClick={() => onShowAllChange(!showAll)}>
                <UsersIcon />
                {showAll ? t("showOnDuty") : t("showAll")}
              </TouchButton>
            </div>
            {data.isLoading ? (
              <div className="grid gap-4 md:grid-cols-2" aria-busy="true">
                {Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="h-[19rem] animate-pulse rounded-3xl bg-muted" />
                ))}
              </div>
            ) : doctors.length === 0 ? (
              <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
                <p className="text-xl font-semibold text-foreground">{t("noDoctorsTitle")}</p>
                <p className="max-w-md text-[17px] text-muted-foreground">{t("noDoctorsBody")}</p>
                {!showAll && data.doctors.length > 0 ? (
                  <TouchButton tone="outline" size="lg" onClick={() => onShowAllChange(true)}>
                    <UsersIcon />
                    {t("showAll")}
                  </TouchButton>
                ) : null}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {doctors.map((d) => (
                  <DoctorTile
                    key={d.id}
                    doctor={d}
                    summary={data.summaries.get(d.id)}
                    onQueue={() => onStart("queue", d.id)}
                    onBook={() => onStart("book", d.id)}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            aria-label={t("arrivalsTitle")}
            className={cn("flex-col gap-4", tab === "arrivals" ? "flex" : "hidden xl:flex")}
          >
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                {t("arrivalsTitle")}{" "}
                <span className="font-semibold text-muted-foreground">{arrivals.length || ""}</span>
              </h2>
              <p className="text-[15px] text-muted-foreground">{t("arrivalsHint")}</p>
            </div>
            {data.isLoading ? (
              <div className="flex flex-col gap-3" aria-busy="true">
                {Array.from({ length: 3 }, (_, i) => (
                  <div key={i} className="h-20 animate-pulse rounded-2xl bg-muted" />
                ))}
              </div>
            ) : (
              <ArrivalsList
                rows={arrivals}
                doctors={doctorById}
                now={now}
                online={online}
                emptyText={hasBookingsToday ? t("arrivalsEmpty") : t("arrivalsNone")}
              />
            )}
          </section>
        </div>
      </div>

      <BottomBar>
        <div className="flex gap-4">
          <TouchButton size="xl" className="h-24 flex-[3] flex-col gap-0.5" onClick={() => onStart("queue")}>
            <span className="inline-flex items-center gap-3 text-[26px]">
              <TicketPlusIcon className="size-8" aria-hidden />
              {t("queueCta")}
            </span>
            <span className="text-[15px] font-medium text-primary-foreground/80">{t("queueCtaHint")}</span>
          </TouchButton>
          <TouchButton
            tone="outline"
            size="xl"
            className="h-24 flex-[2] flex-col gap-0.5"
            onClick={() => onStart("book")}
          >
            <span className="inline-flex items-center gap-3 text-[22px]">
              <CalendarClockIcon className="size-7" aria-hidden />
              {t("bookCta")}
            </span>
            <span className="text-[15px] font-medium text-muted-foreground">{t("bookCtaHint")}</span>
          </TouchButton>
        </div>
      </BottomBar>
    </div>
  );
}

function FlowHeader({
  flow,
  locked,
  onBack,
  onCancel,
  onGoTo,
}: {
  flow: ActiveFlow;
  /**
   * A ticket or booking is being sent: its answer belongs to this patient,
   * so nothing here leaves the flow until it comes (the write times out on
   * its own, see `writeSignal` in book-visit.ts).
   */
  locked: boolean;
  onBack: () => void;
  onCancel: () => void;
  onGoTo: (step: FlowStep) => void;
}) {
  const t = useTranslations("receptionTablet.flow");
  const steps = stepsFor(flow.mode);
  const current = stepNumber(flow.mode, flow.step);
  const label: Record<FlowStep, string> = {
    patient: t("stepPatient"),
    doctor: t("stepDoctor"),
    time: t("stepTime"),
    confirm: t("stepConfirm"),
    done: "",
  };
  return (
    <div className="flex shrink-0 items-center gap-4 border-b border-border bg-card/60 px-6 py-3">
      <TouchButton tone="outline" onClick={onBack} disabled={locked}>
        <ArrowLeftIcon />
        {t("back")}
      </TouchButton>
      <div className="min-w-0">
        <p className="truncate text-xl font-bold text-foreground">
          {flow.mode === "queue" ? t("queueTitle") : t("bookTitle")}
        </p>
        <p className="text-[15px] text-muted-foreground">
          {t("stepOf", { current, total: steps.length })}
        </p>
      </div>
      <ol className="ml-auto hidden items-center gap-2 md:flex">
        {steps.map((s, i) => {
          const done = isStepComplete(flow, s) && s !== flow.step;
          const isCurrent = s === flow.step;
          const reachable = !locked && !isCurrent && canOpenStep(flow, s);
          return (
            <li key={s} className="flex items-center gap-2">
              {i > 0 ? <span className="h-px w-5 bg-border" aria-hidden /> : null}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onGoTo(s)}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={label[s]}
                className={cn(
                  TOUCH,
                  "inline-flex h-14 items-center gap-2 rounded-2xl px-3 text-[15px] font-semibold transition-colors",
                  isCurrent
                    ? "bg-primary/10 text-primary"
                    : done
                      ? "text-foreground active:bg-muted"
                      : "text-muted-foreground",
                  "disabled:cursor-default",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-[15px] font-bold",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : done
                        ? "bg-success text-success-foreground"
                        : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <CheckIcon className="size-4" aria-hidden /> : i + 1}
                </span>
                {/* Labels only where they fit (landscape); the numbers carry
                    the steps in portrait. */}
                <span className="hidden xl:inline">{label[s]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <TouchButton
        tone="ghost"
        onClick={onCancel}
        disabled={locked}
        className="md:ml-2"
        aria-label={t("cancel")}
      >
        <XIcon />
        <span className="hidden xl:inline">{t("cancel")}</span>
      </TouchButton>
    </div>
  );
}

function FlowBody({
  flow,
  data,
  doctorById,
  search,
  onSearchChange,
  showAll,
  onShowAllChange,
  dispatch,
  failure,
  pending,
  onOwnerAnswer,
  onNext,
}: {
  flow: ActiveFlow;
  data: HomeData;
  doctorById: Map<string, TabletDoctor>;
  search: PatientSearchState;
  onSearchChange: (s: PatientSearchState) => void;
  showAll: boolean;
  onShowAllChange: (v: boolean) => void;
  dispatch: React.Dispatch<Parameters<typeof flowReducer>[1]>;
  failure: SubmitFailure | null;
  pending: boolean;
  onOwnerAnswer: (a: "same" | "other") => void;
  onNext: () => void;
}) {
  const doctor = flow.doctorId ? doctorById.get(flow.doctorId) : undefined;
  const summary = flow.doctorId ? data.summaries.get(flow.doctorId) : undefined;

  switch (flow.step) {
    case "patient":
      return (
        <PatientStep
          search={search}
          onSearchChange={onSearchChange}
          onPick={(patient) => dispatch({ type: "pickPatient", patient })}
        />
      );
    case "doctor":
      return (
        <DoctorStep
          mode={flow.mode}
          doctors={data.doctors}
          summaries={data.summaries}
          selectedId={flow.doctorId}
          showAll={showAll}
          onShowAllChange={onShowAllChange}
          onPick={(doctorId) => dispatch({ type: "pickDoctor", doctorId })}
        />
      );
    case "time":
      return flow.doctorId && flow.day ? (
        <TimeStep
          today={data.today}
          doctorId={flow.doctorId}
          day={flow.day}
          time={flow.time}
          serviceId={flow.serviceId}
          onServiceChange={(serviceId) => dispatch({ type: "pickService", serviceId })}
          onDay={(day) => dispatch({ type: "pickDay", day })}
          onTime={(time) => dispatch({ type: "pickTime", time })}
        />
      ) : null;
    case "confirm":
      return (
        <div className="flex flex-col gap-6">
          {/* «Изменить» and the service chips wait for the answer too. */}
          <fieldset disabled={pending} className="m-0 min-w-0 border-0 p-0">
            <ConfirmStep
              flow={flow}
              doctor={doctor}
              summary={summary}
              onGoTo={(s) => dispatch({ type: "goTo", step: s })}
              onService={(serviceId) => dispatch({ type: "pickService", serviceId })}
            />
          </fieldset>
          {flow.owner ? (
            <OwnerQuestionCard owner={flow.owner} pending={pending} onAnswer={onOwnerAnswer} />
          ) : null}
          {failure ? (
            <FailureNote
              failure={failure}
              onPickTime={() => dispatch({ type: "goTo", step: "time" })}
              onPickPatient={() => dispatch({ type: "goTo", step: "patient" })}
              onClearService={() => dispatch({ type: "pickService", serviceId: null })}
            />
          ) : null}
        </div>
      );
    case "done":
      if (!flow.result) return null;
      return flow.result.kind === "ticket" ? (
        <TicketDone
          result={flow.result}
          doctor={doctorById.get(flow.result.doctorId)}
          rows={data.rows}
          onNext={onNext}
        />
      ) : (
        <BookingDone
          result={flow.result}
          doctor={doctorById.get(flow.result.doctorId)}
          onNext={onNext}
        />
      );
  }
}

function FailureNote({
  failure,
  onPickTime,
  onPickPatient,
  onClearService,
}: {
  failure: SubmitFailure;
  onPickTime: () => void;
  onPickPatient: () => void;
  onClearService: () => void;
}) {
  const t = useTranslations("receptionTablet.confirm");
  const tConflict = useTranslations("appointments.drawer.conflict");
  const tLimit = useTranslations("crmToasts.patient.planLimit");
  const tService = useTranslations("receptionTablet.service");
  let text: string;
  let action: React.ReactNode = null;
  switch (failure.kind) {
    case "slot":
      text = conflictReasonText(
        tConflict as unknown as ConflictTranslator,
        failure.reason,
        failure.until,
        t("errors.failed"),
      );
      action = (
        <TouchButton tone="outline" onClick={onPickTime}>
          <CalendarClockIcon />
          {t("pickOtherTime")}
        </TouchButton>
      );
      break;
    case "known":
      text = t(`errors.${failure.code}`);
      if (failure.code === "patient_not_found") {
        action = (
          <TouchButton tone="outline" onClick={onPickPatient}>
            {t("patient")}
          </TouchButton>
        );
      } else if (failure.code === "service_not_offered") {
        action = (
          <TouchButton tone="outline" onClick={onClearService}>
            <CheckIcon />
            {tService("none")}
          </TouchButton>
        );
      }
      break;
    case "planLimit":
      text = tLimit(failure.quota, { max: failure.max });
      break;
    case "network":
      text = t("errors.network");
      break;
    case "bookingUnsure":
      text = t("errors.bookingUnsure");
      break;
    default:
      text = t("errors.failed");
  }
  return (
    <ErrorNote className="mx-auto w-full max-w-3xl" action={action}>
      {text}
    </ErrorNote>
  );
}

function ConfirmActions({
  flow,
  pending,
  online,
  onBack,
  onSubmit,
}: {
  flow: ActiveFlow;
  pending: boolean;
  online: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations("receptionTablet.confirm");
  const tFlow = useTranslations("receptionTablet.flow");
  return (
    <div className="flex gap-4">
      <TouchButton tone="outline" size="xl" onClick={onBack} disabled={pending}>
        <ArrowLeftIcon />
        {tFlow("back")}
      </TouchButton>
      {flow.owner ? null : (
        <TouchButton
          size="xl"
          className="flex-1"
          onClick={onSubmit}
          disabled={pending || !online}
          aria-busy={pending || undefined}
        >
          {flow.mode === "queue" ? <TicketPlusIcon /> : <CalendarClockIcon />}
          {pending
            ? t("submitting")
            : flow.mode === "queue"
              ? t("submitQueue")
              : flow.unsureBooking
                ? t("submitBookCheck")
                : t("submitBook")}
        </TouchButton>
      )}
    </div>
  );
}
