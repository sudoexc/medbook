"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAsyncExport } from "@/hooks/use-async-export";

/**
 * Appointment CSV export via the Phase 5 async worker. Poll → download.
 */
export function ExportButton() {
  const t = useTranslations("appointments");
  const tx = useTranslations("exportsUi");
  const searchParams = useSearchParams();
  const { start, status } = useAsyncExport();

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
    toast.message(tx("enqueued"));
  };

  const running = status === "enqueued" || status === "running";

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
