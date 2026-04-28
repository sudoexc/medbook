"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGridIcon, ListIcon, SettingsIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/atoms/status-dot";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import {
  computeUpcomingReminders,
  useActiveDoctors,
  useIncomingCalls,
  useReceptionCabinets,
  useReceptionDashboard,
  useReceptionRealtime,
  useTodayAppointments,
  useUnreadConversations,
} from "../_hooks/use-reception-live";
import { useDoctorPanelPrefs } from "../_hooks/use-panel-prefs";
import { AppointmentDrawer } from "../../appointments/_components/appointment-drawer";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

import { KpiStrip } from "./kpi-strip";
import { OnboardingChecklist } from "./onboarding-checklist";
import { DoctorQueueGrid } from "./doctor-queue-grid";
import { DoctorQueueList } from "./doctor-queue-list";
import { DayPickerDropdown } from "./day-picker-dropdown";
import { DoctorPanelSettings } from "./doctor-panel-settings";
import { CallsWidget } from "./calls-widget";
import { TgPreviewWidget } from "./tg-preview-widget";
import { QueueColumn } from "./queue-column";
import { BottomRow } from "./bottom-row";

/**
 * Root client shell for `/crm/reception` — matches docs/1 - Ресепшн (2).png.
 *
 * Layout (xl ≥ 1280px):
 *   ┌────────────────────────────────────────────────────┐
 *   │                KPI strip (6 cards)                 │
 *   ├──────────┬───────────────────────┬─────────────────┤
 *   │  ОБЩАЯ   │  КАБИНЕТЫ И ВРАЧИ     │  CALL CENTER    │
 *   │  ОЧЕРЕДЬ │  (doctor cards grid)  │  TELEGRAM       │
 *   ├──────────┴───────────────────────┴─────────────────┤
 *   │ РЕКОМЕНДАЦИИ │ РАСПРЕДЕЛЕНИЕ │ ПРЕДУПРЕЖДЕНИЯ      │
 *   └────────────────────────────────────────────────────┘
 */
export function ReceptionPageClient() {
  useReceptionRealtime();

  const t = useTranslations("reception");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const { prefs, setPrefs, reset: resetPrefs } = useDoctorPanelPrefs();
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const dashboard = useReceptionDashboard();
  const today = useTodayAppointments(selectedDate);
  const doctors = useActiveDoctors();
  const cabinets = useReceptionCabinets();
  const calls = useIncomingCalls();
  const conversations = useUnreadConversations();

  const todayRows = React.useMemo<AppointmentRow[]>(
    () => today.data ?? [],
    [today.data],
  );

  const appointmentsByDoctor = React.useMemo(() => {
    const map = new Map<string, AppointmentRow[]>();
    for (const row of todayRows) {
      const list = map.get(row.doctor.id) ?? [];
      list.push(row);
      map.set(row.doctor.id, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    }
    return map;
  }, [todayRows]);

  const upcomingReminders = React.useMemo(
    () => computeUpcomingReminders(todayRows),
    [todayRows],
  );

  const warnings = React.useMemo(
    () =>
      upcomingReminders.map((r) => ({
        id: r.appointment.id,
        text: t("warnings.template", {
          minutes: r.minutesUntil,
          patient: r.appointment.patient.fullName,
          doctor:
            locale === "uz"
              ? r.appointment.doctor.nameUz
              : r.appointment.doctor.nameRu,
        }),
        tone: (r.minutesUntil <= 15 ? "danger" : "warning") as
          | "danger"
          | "warning",
      })),
    [upcomingReminders, t, locale],
  );

  // Drawer state via `?ap=` search param.
  const openRowId = searchParams?.get("ap") ?? null;
  const openRow = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (id) sp.set("ap", id);
      else sp.delete("ap");
      const qs = sp.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogPrefill, setDialogPrefill] = React.useState<{
    patientId?: string | null;
    doctorId?: string | null;
  } | null>(null);

  const openCreate = React.useCallback(
    (prefill?: { patientId?: string | null; doctorId?: string | null }) => {
      setDialogPrefill(prefill ?? null);
      setDialogOpen(true);
    },
    [],
  );

  const isLoading =
    dashboard.isLoading || today.isLoading || doctors.isLoading;

  const sortedDoctors = React.useMemo(() => {
    const list = (doctors.data ?? []).slice();
    if (prefs.hideIdle) {
      const visible = list.filter((d) => {
        const items = appointmentsByDoctor.get(d.id) ?? [];
        return items.length > 0;
      });
      // Keep sorted base for predictable rendering when hideIdle removes some.
      list.length = 0;
      list.push(...visible);
    }
    if (prefs.sortBy === "name") {
      list.sort((a, b) => a.nameRu.localeCompare(b.nameRu));
    } else if (prefs.sortBy === "next") {
      const nextTime = (id: string): number => {
        const items = appointmentsByDoctor.get(id) ?? [];
        const upcoming = items
          .filter(
            (a) => a.queueStatus === "WAITING" || a.queueStatus === "BOOKED",
          )
          .map((a) => new Date(a.date).getTime());
        return upcoming.length ? Math.min(...upcoming) : Number.POSITIVE_INFINITY;
      };
      list.sort((a, b) => nextTime(a.id) - nextTime(b.id));
    } else {
      // load (default): most appointments first, name as tiebreak
      list.sort((a, b) => {
        const ca = appointmentsByDoctor.get(a.id)?.length ?? 0;
        const cb = appointmentsByDoctor.get(b.id)?.length ?? 0;
        if (cb !== ca) return cb - ca;
        return a.nameRu.localeCompare(b.nameRu);
      });
    }
    return list;
  }, [doctors.data, appointmentsByDoctor, prefs.hideIdle, prefs.sortBy]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            <StatusDot status="online" size="xs" />
            {t("liveBadge")}
          </span>
          <span className="hidden md:inline">
            {t("autoRefresh")}
          </span>
        </div>
      </div>

      <OnboardingChecklist />

      <KpiStrip dashboard={dashboard.data} todayRows={todayRows} />

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <QueueColumn rows={todayRows} />

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {t("doctorsPanel.title")}
            </h2>
            <div className="flex items-center gap-1.5">
              <DayPickerDropdown
                selected={selectedDate}
                onChange={setSelectedDate}
              />
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  aria-pressed={prefs.view === "grid"}
                  onClick={() => setPrefs({ view: "grid" })}
                  className={cn(
                    "inline-flex size-8 items-center justify-center transition-colors",
                    prefs.view === "grid"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={t("doctorsPanel.viewGrid")}
                >
                  <LayoutGridIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-pressed={prefs.view === "list"}
                  onClick={() => setPrefs({ view: "list" })}
                  className={cn(
                    "inline-flex size-8 items-center justify-center border-l border-border transition-colors",
                    prefs.view === "list"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={t("doctorsPanel.viewList")}
                >
                  <ListIcon className="size-3.5" />
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="size-3.5" />
                {t("doctorsPanel.configure")}
              </Button>
            </div>
          </div>
          {prefs.view === "grid" ? (
            <DoctorQueueGrid
              doctors={sortedDoctors}
              appointmentsByDoctor={appointmentsByDoctor}
              isLoading={isLoading}
              onRowClick={(id) => openRow(id)}
              onAddAppointment={(doctorId) => openCreate({ doctorId })}
            />
          ) : (
            <DoctorQueueList
              doctors={sortedDoctors}
              appointmentsByDoctor={appointmentsByDoctor}
              isLoading={isLoading}
              onRowClick={(id) => openRow(id)}
              onAddAppointment={(doctorId) => openCreate({ doctorId })}
              density={prefs.density}
              showCabinet={prefs.showCabinet}
              showNextSlot={prefs.showNextSlot}
            />
          )}
        </section>

        <aside
          aria-label={t("a11y.rightRail")}
          className={cn(
            "flex min-h-0 flex-col gap-3",
          )}
        >
          <CallsWidget
            rows={calls.data ?? []}
            isLoading={calls.isLoading}
            onQuickAppointment={({ patientId }) =>
              openCreate({ patientId })
            }
          />
          <TgPreviewWidget
            rows={conversations.data ?? []}
            isLoading={conversations.isLoading}
          />
        </aside>
      </div>

      <BottomRow todayRows={todayRows} warnings={warnings} />

      <AppointmentDrawer
        appointmentId={openRowId}
        onClose={() => openRow(null)}
      />

      <NewAppointmentDialog
        open={dialogOpen}
        onOpenChange={(v) => {
          setDialogOpen(v);
          if (!v) setDialogPrefill(null);
        }}
        patientId={dialogPrefill?.patientId ?? null}
        initialDoctorId={dialogPrefill?.doctorId ?? null}
        onCreated={(id) => openRow(id)}
      />

      <DoctorPanelSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        setPrefs={setPrefs}
        reset={resetPrefs}
      />
      {/* cabinets data is exposed via DoctorQueueGrid cards; keep hook subscribed */}
      <div className="sr-only">
        {cabinets.data?.length ?? 0}
      </div>
    </div>
  );
}

export default ReceptionPageClient;
