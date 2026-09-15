"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

import {
  useReceptionContext,
  type ReceptionTab,
} from "../_hooks/reception-context";

// Documents / labs / prescriptions used to be sibling tabs. They are not
// independent of the visit that produced them — they ARE the visit — so they
// now live inside «История визитов», each under its own visit. Three flat
// lists became one timeline, and answering «что я назначал в прошлый раз»
// stopped meaning "open three tabs and match them up by date".
const TABS: ReadonlyArray<{ key: ReceptionTab; labelKey: string }> = [
  { key: "session", labelKey: "tabs.session" },
  { key: "history", labelKey: "tabs.history" },
];

export function SessionTabs() {
  const tr = useTranslations("doctor.reception");
  const { activeTab, setActiveTab, activeAppointment } = useReceptionContext();
  // "История визитов / Документы / Назначения" require a selected patient.
  // Without one, we disable the non-session tabs so a misclick doesn't
  // surface an empty panel that the doctor reads as a bug.
  const hasPatient = !!activeAppointment?.patient.id;

  return (
    <div className="flex items-center gap-1 border-b border-border">
      {TABS.map((t) => {
        const isActive = t.key === activeTab;
        const isDisabled = t.key !== "session" && !hasPatient;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              if (isDisabled) return;
              setActiveTab(t.key);
            }}
            disabled={isDisabled}
            aria-selected={isActive}
            className={cn(
              "relative -mb-px inline-flex h-10 items-center px-4 text-sm font-medium transition-colors",
              isActive
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
              isDisabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
            )}
          >
            {tr(t.labelKey)}
            {isActive && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}
