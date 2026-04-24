"use client";

import * as React from "react";
import { PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { PageContainer } from "@/components/molecules/page-container";
import { Button } from "@/components/ui/button";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import {
  flattenAppointments,
  tallyStatuses,
  useAppointmentsList,
  useAppointmentsRealtime,
} from "../_hooks/use-appointments-list";
import { useAppointmentsFilters } from "../_hooks/use-appointments-filters";
import { AppointmentsFilters } from "./appointments-filters";
import { AppointmentsTiles } from "./appointments-tiles";
import { AppointmentsKpiStrip } from "./appointments-kpi-strip";
import { AppointmentsBulkBar } from "./appointments-bulk-bar";
import { AppointmentsTable } from "./appointments-table";
import { AppointmentsRightRail } from "./appointments-right-rail";
import { AppointmentDrawer } from "./appointment-drawer";
import { ExportButton } from "./export-button";

/**
 * Root client component for `/crm/appointments` (TZ §6.2).
 *
 * Responsibilities:
 *  - Own the URL-synced filter state via `useAppointmentsFilters`.
 *  - Drive the virtualised table, KPI bucket strip, filter bar, bulk bar,
 *    row drawer and right rail.
 *  - Own transient UI state: current selection set, dialog prefill, open row.
 */
export function AppointmentsPageClient() {
  useAppointmentsRealtime();

  const t = useTranslations("appointments");
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, apiFilters, setFilter, clearAll } = useAppointmentsFilters();

  // --- dialog state --------------------------------------------------------
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [dialogPrefill, setDialogPrefill] = React.useState<{
    doctorId?: string | null;
    date?: Date | null;
    time?: string | null;
    patientId?: string | null;
  } | null>(null);

  const openCreateDialog = (prefill?: {
    doctorId?: string | null;
    date?: Date | null;
    time?: string | null;
    patientId?: string | null;
  }) => {
    setDialogPrefill(prefill ?? null);
    setDialogOpen(true);
  };

  // --- drawer state (synced via `?ap=`) -----------------------------------
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

  // --- selection -----------------------------------------------------------
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const toggleSelect = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  // --- data ----------------------------------------------------------------
  const query = useAppointmentsList(apiFilters);
  const rows = React.useMemo(
    () => flattenAppointments(query.data),
    [query.data],
  );
  const tally = React.useMemo(() => tallyStatuses(rows), [rows]);
  const total = query.data?.pages?.[0]?.total ?? null;

  const toggleSelectAll = (on: boolean) => {
    if (on) {
      setSelected(new Set(rows.map((r) => r.id)));
    } else {
      setSelected(new Set());
    }
  };

  const hasFilters =
    Boolean(state.q) ||
    Boolean(state.doctorId) ||
    Boolean(state.serviceId) ||
    Boolean(state.cabinetId) ||
    Boolean(state.channel) ||
    Boolean(state.onlyUnpaid) ||
    (state.bucket && state.bucket !== "all") ||
    (state.dateMode && state.dateMode !== "today") ||
    Boolean(state.from) ||
    Boolean(state.to);

  const currentBucket = state.bucket ?? "all";
  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  const sendRemindersAll = () => {
    // TODO(api): dedicated bulk reminders endpoint.
    toast.info(t("rail.remindersStub"));
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer className="flex-1 pb-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t("subtitle")}
              {total !== null ? (
                <>
                  {" · "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {t("count", { count: total })}
                  </span>
                </>
              ) : null}
            </p>
            <div className="flex items-center gap-2">
              <ExportButton />
              <Button onClick={() => openCreateDialog()}>
                <PlusIcon className="size-4" />
                {t("new")}
              </Button>
            </div>
          </div>

          <AppointmentsTiles rows={rows} total={total} />

          <AppointmentsFilters
            state={state}
            onChange={setFilter}
            onClear={() => {
              clearAll();
              setSelected(new Set());
            }}
          />

          <AppointmentsKpiStrip
            tally={tally}
            active={currentBucket}
            onChange={(next) =>
              setFilter("bucket", next === "all" ? undefined : next)
            }
          />

          {selectedIds.length > 0 ? (
            <AppointmentsBulkBar
              selectedIds={selectedIds}
              rows={rows}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          <div className="flex min-h-[60vh] flex-1 flex-col">
            <AppointmentsTable
              rows={rows}
              isLoading={query.isLoading}
              isFetchingNextPage={query.isFetchingNextPage}
              hasNextPage={Boolean(query.hasNextPage)}
              onLoadMore={() => query.fetchNextPage()}
              hasFilters={Boolean(hasFilters)}
              onCreate={() => openCreateDialog()}
              onRowSelect={(id) => openRow(id)}
              selectedIds={selected}
              onToggleSelect={toggleSelect}
              onToggleSelectAll={toggleSelectAll}
              sort={state.sort}
              dir={state.dir}
              onSortChange={(sort, dir) => {
                setFilter("sort", sort);
                setFilter("dir", dir);
              }}
              total={total}
            />
          </div>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-card p-3 xl:flex"
        aria-label={t("rail.quickActions")}
      >
        <AppointmentsRightRail
          rows={rows}
          onSlotPick={({ doctorId, date, time }) =>
            openCreateDialog({ doctorId, date, time })
          }
          onExport={() => {
            const qs = searchParams?.toString() ?? "";
            const href = qs
              ? `/api/crm/appointments/export-csv?${qs}`
              : `/api/crm/appointments/export-csv`;
            window.location.href = href;
          }}
          onSendRemindersAll={sendRemindersAll}
        />
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
        initialDoctorId={dialogPrefill?.doctorId ?? null}
        initialDate={dialogPrefill?.date ?? null}
        initialTime={dialogPrefill?.time ?? null}
        onCreated={(id) => openRow(id)}
      />
    </div>
  );
}

export default AppointmentsPageClient;
