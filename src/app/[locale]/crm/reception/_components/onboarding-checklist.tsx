"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  BriefcaseIcon,
  BuildingIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  StethoscopeIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

type Steps = {
  clinic: boolean;
  cabinets: boolean;
  services: boolean;
  doctors: boolean;
};

type OnboardingStatus = {
  steps: Steps;
  counts: { cabinets: number; services: number; doctors: number };
  complete: boolean;
};

function useOnboardingStatus() {
  return useQuery<OnboardingStatus, Error>({
    queryKey: ["onboarding", "status"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/onboarding-status", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as OnboardingStatus;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

type StepKey = keyof Steps;

const STEP_CONFIG: ReadonlyArray<{ key: StepKey; href: string; icon: LucideIcon }> =
  [
    { key: "clinic", href: "/crm/settings/clinic", icon: BuildingIcon },
    { key: "cabinets", href: "/crm/settings/cabinets", icon: BriefcaseIcon },
    { key: "services", href: "/crm/settings/services", icon: BriefcaseIcon },
    { key: "doctors", href: "/crm/settings/users", icon: StethoscopeIcon },
  ];

/**
 * Progressive setup checklist shown above the reception dashboard while the
 * clinic team fills in the basics. Auto-hides once all four steps are done.
 *
 * Steps are independent — clinic admin can tackle them in any order, but the
 * suggested path is clinic → cabinets → services → doctors so doctors can be
 * created with a service list and a cabinet to match against.
 */
export function OnboardingChecklist({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations("onboardingChecklist");
  const { data } = useOnboardingStatus();

  if (!data || data.complete) return null;

  const steps = STEP_CONFIG.map((cfg) => ({
    ...cfg,
    done: data.steps[cfg.key],
  }));
  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const progressPct = Math.round((doneCount / total) * 100);

  return (
    <section
      aria-label={t("ariaLabel")}
      className={cn(
        "rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 via-card to-card p-4 shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-foreground">{t("title")}</h2>
          <p className="text-[12px] text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[12px] font-semibold tabular-nums text-muted-foreground">
            {t("progressLabel", { done: doneCount, total })}
          </span>
          <div
            aria-hidden
            className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => {
          const Icon = step.icon;
          const StatusIcon = step.done ? CheckCircle2Icon : CircleIcon;
          return (
            <li key={step.key}>
              <Link
                href={`/${locale}${step.href}`}
                aria-current={step.done ? undefined : "step"}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all",
                  step.done
                    ? "border-success/30 bg-success/5"
                    : "border-border bg-background hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
                    step.done
                      ? "bg-success/15 text-success"
                      : "bg-primary/10 text-primary",
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <StatusIcon
                      className={cn(
                        "size-3.5 shrink-0",
                        step.done ? "text-success" : "text-muted-foreground",
                      )}
                      aria-hidden
                    />
                    <span className="truncate">{t(`steps.${step.key}.label`)}</span>
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {step.done
                      ? t("doneLabel")
                      : t(`steps.${step.key}.hint`)}
                  </div>
                </div>
                {!step.done ? (
                  <ChevronRightIcon
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
