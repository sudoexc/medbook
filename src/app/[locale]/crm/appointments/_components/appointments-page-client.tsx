"use client";

import * as React from "react";
import { AlertTriangleIcon, PlusIcon, RotateCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";

import { PageContainer } from "@/components/molecules/page-container";
import { EmptyState } from "@/components/atoms/empty-state";
import { Button } from "@/components/ui/button";

import { NewAppointmentDialog } from "@/components/appointments/NewAppointmentDialog";

import {
  filterRowsByBucket,
  flattenAppointments,
  useAppointmentsList,
  useAppointmentsRealtime,
} from "../_hooks/use-appointments-list";
import { useAppointmentsFilters } from "../_hooks/use-appointments-filters";
import { useBulkReminders } from "../_hooks/use-bulk-reminders";
import { AppointmentsFilters } from "./appointments-filters";
import { AppointmentsTiles } from "./appointments-tiles";
import { AppointmentsBulkBar } from "./appointments-bulk-bar";
import { AppointmentsTable } from "./appointments-table";
import { AppointmentsRightRail } from "./appointments-right-rail";
import { AppointmentDrawer } from "./appointment-drawer";
import { ExportButton } from "./export-button";
import { RISK_TODAY_FROM } from "../../action-center/_hooks/use-risk-today";

/**
 * Root client component for `/crm/appointments` (TZ §6.2).
 *
 * Responsibilities:
 *  - Own the URL-synced filter state via `useAppointmentsFilters`.
 *  - Drive the virtualised table, tiles, filter bar, bulk bar,
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
  // Opened by a risk-today row's «Перенести» (audit AC-10): a new time saved
  // in the drawer records that outcome. The marker belongs to that one visit,
  // so it is dropped as soon as the drawer closes or shows another row.
  const recordsRiskReschedule =
    openRowId !== null && searchParams?.get("from") === RISK_TODAY_FROM;
  const openRow = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(searchParams?.toString() ?? "");
      if (id) sp.set("ap", id);
      else sp.delete("ap");
      if (sp.get("from") === RISK_TODAY_FROM) sp.delete("from");
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
  const allRows = React.useMemo(
    () => flattenAppointments(query.data),
    [query.data],
  );
  // The table sees the bucket-narrowed slice; the tiles count on the server.
  const rows = React.useMemo(
    () => filterRowsByBucket(allRows, state.bucket ?? null),
    [allRows, state.bucket],
  );
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

  const selectedIds = React.useMemo(() => Array.from(selected), [selected]);

  const { send: sendReminders, isPending: remindersBusy } = useBulkReminders();

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageContainer fullBleed className="flex-1 pb-0">
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

          <AppointmentsTiles
            tally={query.data?.pages?.[0]?.tally}
            activeBucket={state.bucket ?? "all"}
            onSelect={(b) => setFilter("bucket", b as typeof state.bucket)}
          />

          <AppointmentsFilters
            state={state}
            onChange={setFilter}
            onClear={() => {
              clearAll();
              setSelected(new Set());
            }}
          />

          {selectedIds.length > 0 ? (
            <AppointmentsBulkBar
              selectedIds={selectedIds}
              rows={rows}
              onClear={() => setSelected(new Set())}
            />
          ) : null}

          <div className="flex min-h-[60vh] flex-1 flex-col">
            {query.isError ? (
              <EmptyState
                icon={<AlertTriangleIcon />}
                title={t("loadError.title")}
                description={t("loadError.description")}
                action={
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => query.refetch()}
                    className="gap-2"
                  >
                    <RotateCwIcon className="size-4" />
                    {t("loadError.retry")}
                  </Button>
                }
                className="my-4"
              />
            ) : (
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
            )}
          </div>
        </PageContainer>
      </div>

      <aside
        className="hidden w-[320px] shrink-0 flex-col border-l border-border bg-card p-3 xl:flex"
        aria-label={t("rail.quickActions")}
      >
        <AppointmentsRightRail
          rows={rows}
          selectedDoctorId={state.doctorId ?? null}
          onSlotPick={({ doctorId, date, time }) =>
            openCreateDialog({ doctorId, date, time })
          }
          onSendReminders={sendReminders}
          remindersBusy={remindersBusy}
        />
      </aside>

      <AppointmentDrawer
        appointmentId={openRowId}
        onClose={() => openRow(null)}
        recordsRiskReschedule={recordsRiskReschedule}
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
