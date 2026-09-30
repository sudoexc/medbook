"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useAsyncExport, useAsyncExportToasts } from "@/hooks/use-async-export";
import { canExport } from "@/lib/export-roles";

import { useCurrentRole } from "../[id]/_hooks/use-current-role";

/**
 * Patient CSV export button.
 *
 * Phase 5 flow: enqueue a worker job, poll, download. Preserves the current
 * URL filters as the job's payload. Phase 2 direct-stream endpoint stays
 * registered as a fallback (the browser can still hit `/api/crm/patients/export`
 * directly for tiny datasets; we simply don't use it from the UI anymore).
 */
export function ExportButton() {
  const t = useTranslations("patients");
  const searchParams = useSearchParams();
  const role = useCurrentRole();
  const { start, status, error } = useAsyncExport();
  // The API's answer, not the click, decides what the button says (AN-27).
  useAsyncExportToasts(status, error);

  const onClick = () => {
    const filters: Record<string, unknown> = {};
    const sp = searchParams;
    if (sp) {
      const get = (k: string) => sp.get(k);
      const segment = get("segment");
      const gender = get("gender");
      const source = get("source");
      const tag = get("tag");
      if (segment) filters.segment = segment;
      if (gender) filters.gender = gender;
      if (source) filters.source = source;
      if (tag) filters.tag = tag;
    }
    void start({ kind: "patients", filters });
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
