"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAsyncExport, useAsyncExportToasts } from "@/hooks/use-async-export";
import { canExport } from "@/lib/export-roles";

import { useCurrentRole } from "../../patients/[id]/_hooks/use-current-role";
import {
  appointmentExportFilters,
  useAppointmentsFilters,
} from "../_hooks/use-appointments-filters";

/**
 * Appointment CSV export via the Phase 5 async worker. Poll → download.
 * The file holds the rows of the list on screen: it used to send only the
 * doctor, status and raw `from`/`to`, so «Сегодня» exported the whole base.
 */
export function ExportButton() {
  const t = useTranslations("appointments");
  // The list's own resolved filters (audit INF-02): «Сегодня» is today's
  // Tashkent window, the tile is a status, the search box is the search.
  const { state, apiFilters } = useAppointmentsFilters();
  const role = useCurrentRole();
  const { start, status, error } = useAsyncExport();
  // The API's answer, not the click, decides what the button says (AN-27).
  useAsyncExportToasts(status, error);

  const onClick = () => {
    void start({
      kind: "appointments",
      filters: appointmentExportFilters(state, apiFilters),
    });
  };

  const running = status === "enqueued" || status === "running";
  // Only the roles the export API lets in see the button (audit AN-27).
  if (!canExport(role)) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={running}
    >
      {running ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
      {t("export")}
    </Button>
  );
}
