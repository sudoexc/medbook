"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDownIcon, LayoutGridIcon, ListIcon, SettingsIcon } from "lucide-react";

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
import { AppointmentDrawer } from "../../appointments/_components/appointment-drawer";
import type { AppointmentRow } from "../../appointments/_hooks/use-appointments-list";

import { KpiStrip } from "./kpi-strip";
import { DoctorQueueGrid } from "./doctor-queue-grid";
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

  const dashboard = useReceptionDashboard();
  const today = useTodayAppointments();
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

  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");

  const isLoading =
    dashboard.isLoading || today.isLoading || doctors.isLoading;

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

      <KpiStrip dashboard={dashboard.data} todayRows={todayRows} />

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
        <QueueColumn rows={todayRows} />

        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {t("doctorsPanel.title")}
            </h2>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
              >
                {t("doctorsPanel.day")}
                <ChevronDownIcon className="size-3.5" />
              </Button>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                <button
                  type="button"
                  aria-pressed={viewMode === "grid"}
                  onClick={() => setViewMode("grid")}
                  className={cn(
                    "inline-flex size-8 items-center justify-center transition-colors",
                    viewMode === "grid"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                  aria-label={t("doctorsPanel.viewGrid")}
                >
                  <LayoutGridIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                  className={cn(
                    "inline-flex size-8 items-center justify-center border-l border-border transition-colors",
                    viewMode === "list"
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
              >
                <SettingsIcon className="size-3.5" />
                {t("doctorsPanel.configure")}
              </Button>
            </div>
          </div>
          <DoctorQueueGrid
            doctors={doctors.data ?? []}
            appointmentsByDoctor={appointmentsByDoctor}
            isLoading={isLoading}
            onRowClick={(id) => openRow(id)}
            onAddAppointment={(doctorId) => openCreate({ doctorId })}
          />
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
      {/* cabinets data is exposed via DoctorQueueGrid cards; keep hook subscribed */}
      <div className="sr-only">
        {cabinets.data?.length ?? 0}
      </div>
    </div>
  );
}

export default ReceptionPageClient;
