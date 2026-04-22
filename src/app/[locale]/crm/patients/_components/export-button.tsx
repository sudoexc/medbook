"use client";

import * as React from "react";
import { DownloadIcon, Loader2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { useAsyncExport } from "@/hooks/use-async-export";

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
  const tx = useTranslations("exportsUi");
  const searchParams = useSearchParams();
  const { start, status } = useAsyncExport();

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
