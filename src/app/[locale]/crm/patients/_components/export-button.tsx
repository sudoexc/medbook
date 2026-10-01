"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAsyncExport, useAsyncExportToasts } from "@/hooks/use-async-export";
import { canExport } from "@/lib/export-roles";

import { useCurrentRole } from "../[id]/_hooks/use-current-role";
import {
  exportFiltersOf,
  parse as parsePatientsFilters,
} from "../_hooks/use-patients-filters";

/**
 * Patient CSV export button.
 *
 * Phase 5 flow: enqueue a worker job, poll, download. The job carries every
 * filter of the list on screen, so the file is the list. Phase 2
 * direct-stream endpoint stays registered as a fallback (the browser can
 * still hit `/api/crm/patients/export` directly; the UI does not use it).
 */
export function ExportButton() {
  const t = useTranslations("patients");
  const searchParams = useSearchParams();
  const role = useCurrentRole();
  const { start, status, error } = useAsyncExport();
  // The API's answer, not the click, decides what the button says (AN-27).
  useAsyncExportToasts(status, error);

  const onClick = () => {
    // Every filter the list on screen applies, read with the list's own
    // parser (audit PT-19): the search box and the periods used to be
    // dropped, and the file held the whole base.
    const state = parsePatientsFilters(
      new URLSearchParams(searchParams?.toString() ?? ""),
    );
    void start({ kind: "patients", filters: exportFiltersOf(state) });
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
