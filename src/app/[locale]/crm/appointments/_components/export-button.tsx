"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAsyncExport, useAsyncExportToasts } from "@/hooks/use-async-export";
import { canExport } from "@/lib/export-roles";

import { useCurrentRole } from "../../patients/[id]/_hooks/use-current-role";

/**
 * Appointment CSV export via the Phase 5 async worker. Poll → download.
 */
export function ExportButton() {
  const t = useTranslations("appointments");
  const searchParams = useSearchParams();
  const role = useCurrentRole();
  const { start, status, error } = useAsyncExport();
  // The API's answer, not the click, decides what the button says (AN-27).
  useAsyncExportToasts(status, error);

  const onClick = () => {
    const filters: Record<string, unknown> = {};
    const sp = searchParams;
    if (sp) {
      const doctorId = sp.get("doctorId") ?? sp.get("doctor");
      const statusF = sp.get("status");
      const dateFrom = sp.get("from");
      const dateTo = sp.get("to");
      if (doctorId) filters.doctorId = doctorId;
      if (statusF) filters.status = statusF;
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;
    }
    void start({ kind: "appointments", filters });
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
