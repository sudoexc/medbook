"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { TagChip } from "@/components/atoms/tag-chip";

import type { PatientsStats } from "../_hooks/use-patients-stats";

export interface TopServicesWidgetProps {
  stats: PatientsStats | undefined;
  isLoading: boolean;
}

/**
 * Top 5 tags across patients. Named `TopServicesWidget` because in the MVP
 * "services history" is tracked as tags on the patient (e.g. `ecg`, `uzi`);
 * Phase 4 will replace this with a real top-services aggregation.
 */
export function TopServicesWidget({ stats, isLoading }: TopServicesWidgetProps) {
  const t = useTranslations("patients.widgets");
  const tags = stats?.topTags ?? [];
  const max = tags[0]?.count ?? 1;

  return (
    <section className="rounded-lg border border-border bg-background p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("topServices")}
      </h4>
      {isLoading ? (
        <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
          …
        </div>
      ) : tags.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("topServicesEmpty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {tags.map((tag) => (
            <li key={tag.tag} className="flex items-center gap-2">
              <TagChip color="info" label={tag.tag} />
              <div className="relative flex-1 rounded-full bg-muted/60">
                <div
                  className="h-1.5 rounded-full bg-primary"
                  style={{ width: `${(tag.count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                {tag.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
