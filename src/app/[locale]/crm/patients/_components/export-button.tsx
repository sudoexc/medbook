"use client";

import * as React from "react";
import { DownloadIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Triggers CSV export at `/api/crm/patients/export` preserving the current
 * URL filters. Uses a plain `<a>` so the browser handles the streaming
 * download without blocking the UI thread. Styled via `buttonVariants` to
 * stay consistent with the rest of the toolbar.
 */
export function ExportButton() {
  const t = useTranslations("patients");
  const searchParams = useSearchParams();

  const href = React.useMemo(() => {
    const qs = searchParams?.toString() ?? "";
    return qs ? `/api/crm/patients/export?${qs}` : "/api/crm/patients/export";
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
