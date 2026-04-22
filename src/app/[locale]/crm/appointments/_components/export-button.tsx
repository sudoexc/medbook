"use client";

import * as React from "react";
import { DownloadIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Triggers CSV export at `/api/crm/appointments/export-csv` preserving the
 * current URL filters. The endpoint is expected to stream the same shape as
 * `/api/crm/patients/export` (RFC 4180 + UTF-8 BOM); creation is tracked in
 * the TODO list for api-builder (Phase 2b wrap-up).
 */
export function ExportButton() {
  const t = useTranslations("appointments");
  const searchParams = useSearchParams();

  const href = React.useMemo(() => {
    const qs = searchParams?.toString() ?? "";
    return qs
      ? `/api/crm/appointments/export-csv?${qs}`
      : "/api/crm/appointments/export-csv";
  }, [searchParams]);

  return (
    <a
      href={href}
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <DownloadIcon className="size-4" />
      {t("export")}
    </a>
  );
}
