"use client";

import { useTranslations } from "next-intl";
import { UploadIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  useDocumentsFilters,
  type DocumentTab,
} from "../_hooks/documents-context";

const TABS: Array<{ key: DocumentTab; labelKey: string }> = [
  { key: "all", labelKey: "tabs.all" },
  { key: "REFERRAL", labelKey: "tabs.referral" },
  { key: "PRESCRIPTION", labelKey: "tabs.prescription" },
  { key: "RESULT", labelKey: "tabs.result" },
  { key: "CONSENT", labelKey: "tabs.consent" },
  { key: "CONTRACT", labelKey: "tabs.contract" },
  { key: "RECEIPT", labelKey: "tabs.receipt" },
  { key: "OTHER", labelKey: "tabs.other" },
];

export function DocumentsHeader({
  onOpenUpload,
}: {
  onOpenUpload: () => void;
}) {
  const t = useTranslations("doctor.documents");
  const { tab, setTab } = useDocumentsFilters();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("header.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("header.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <UploadIcon className="size-4" />
          {t("actions.upload")}
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((item) => {
            const isActive = item.key === tab;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <span>{t(item.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
