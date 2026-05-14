"use client";

import { UploadIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import {
  useDocumentsFilters,
  type DocumentTab,
} from "../_hooks/documents-context";

const TABS: Array<{ key: DocumentTab; label: string }> = [
  { key: "all", label: "Все документы" },
  { key: "REFERRAL", label: "Направления" },
  { key: "PRESCRIPTION", label: "Рецепты" },
  { key: "RESULT", label: "Результаты" },
  { key: "CONSENT", label: "Согласия" },
  { key: "CONTRACT", label: "Договоры" },
  { key: "RECEIPT", label: "Чеки" },
  { key: "OTHER", label: "Прочее" },
];

export function DocumentsHeader({
  onOpenUpload,
}: {
  onOpenUpload: () => void;
}) {
  const { tab, setTab } = useDocumentsFilters();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Документы</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Документы ваших пациентов и приёмов
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <UploadIcon className="size-4" />
          Загрузить
        </button>
      </div>

      <section className="rounded-2xl border border-border bg-card p-2">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => {
            const isActive = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-muted",
                )}
              >
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
