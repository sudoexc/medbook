"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PlusIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/molecules/page-container";
import { SectionHeader } from "@/components/molecules/section-header";
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
import { CabinetsWidget } from "./cabinets-widget";
import { RemindersWidget } from "./reminders-widget";

/**
 * Root client shell for `/crm/reception` (TZ §6.1).
 *
 * Layout: a full-bleed two-column layout (main queue + right rail) above
 * 1280px. The right rail hosts calls / TG / cabinets / reminders widgets
 * in a fixed, scrollable column. Below 1280px the rail drops beneath the
 * grid so the page stays usable on a tablet-sized receptionist screen.
 */
export function ReceptionPageClient() {
  useReceptionRealtime();

  const t = useTranslations("reception");
  const router = useRouter();
  const searchParams = useSearchParams();

  const dashboard = useReceptionDashboard();
  const today = useTodayAppointments();
  const doctors = useActiveDoctors();
  const cabinets = useReceptionCabinets();
  const calls = useIncomingCalls();
  const conversations = useUnreadConversations();

  const todayRows: AppointmentRow[] = today.data ?? [];

  // Group today's appointments by doctor once so cards share a stable reference.
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

  // Drawer state via `?ap=` search param (shared with /crm/appointments).
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

  // NewAppointmentDialog prefill.
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogPrefill, setDialogPrefill] = React.useState<{
    patientId?: string | null;
  } | null>(null);

  const openCreate = React.useCallback(
    (prefill?: { patientId?: string | null }) => {
      setDialogPrefill(prefill ?? null);
      setDialogOpen(true);
    },
    [],
  );

  const isLoading =
    dashboard.isLoading || today.isLoading || doctors.isLoading;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer fullBleed className="flex-1 pb-0">
          <SectionHeader
            title={t("title")}
            subtitle={t("subtitle")}
            meta={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-[color:var(--success)]">
                <StatusDot status="online" size="xs" />
                {t("liveBadge")}
              </span>
            }
            actions={
              <Button onClick={() => openCreate()}>
                <PlusIcon className="size-4" />
                {t("newAppointment")}
              </Button>
            }
          />

          <KpiStrip dashboard={dashboard.data} todayRows={todayRows} />

          <SectionHeader
            title={t("doctorQueue.title")}
            subtitle={t("doctorQueue.subtitle")}
          />

          <DoctorQueueGrid
            doctors={doctors.data ?? []}
            appointmentsByDoctor={appointmentsByDoctor}
            isLoading={isLoading}
            onRowClick={(id) => openRow(id)}
          />
        </PageContainer>
      </div>

      <aside
        aria-label={t("a11y.rightRail")}
        className={cn(
          "hidden w-[340px] shrink-0 flex-col gap-3 border-l border-border bg-surface p-3 xl:flex",
          "overflow-y-auto",
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
        <CabinetsWidget
          cabinets={cabinets.data ?? []}
          todayRows={todayRows}
        />
        <RemindersWidget reminders={upcomingReminders} />
      </aside>

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
        onCreated={(id) => openRow(id)}
      />
    </div>
  );
}

export default ReceptionPageClient;
