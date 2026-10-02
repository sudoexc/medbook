"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import { usePatientsFilters } from "../_hooks/patients-context";
import type { DoctorPatientTab } from "../_hooks/use-my-patients";

const TABS: Array<{
  key: DoctorPatientTab;
  labelKey: string;
  highlight?: "danger";
}> = [
  { key: "all", labelKey: "tabs.all" },
  { key: "today", labelKey: "tabs.today" },
  { key: "active", labelKey: "tabs.active" },
  { key: "new", labelKey: "tabs.new" },
  { key: "watch", labelKey: "tabs.watch" },
  { key: "returned", labelKey: "tabs.returned" },
  { key: "dormant", labelKey: "tabs.dormant", highlight: "danger" },
];

export function PatientsHeader() {
  const t = useTranslations("doctor.patients");
  const { filters, setTab } = usePatientsFilters();
  const active = filters.tab ?? "all";

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
        <nav className="flex flex-wrap items-center gap-1">
          {TABS.map((tab) => {
            const isActive = tab.key === active;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setTab(tab.key)}
                className={cn(
                  "relative inline-flex items-center gap-2 px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{t(tab.labelKey)}</span>
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 -bottom-px h-0.5 bg-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* «Экспорт» removed per doctor feedback; «Настроить вид» had no
            action behind it (DC-17). */}
      </div>
    </>
  );
}
