"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { MegaphoneIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/atoms/empty-state";

import type { Template } from "../_hooks/use-templates";

type Props = {
  templates: Template[];
};

/**
 * Stub for the campaigns list. Full segment builder lives in Phase 5.
 * For Phase 3a we just surface the empty-state + primary CTA so the UI
 * is navigable and matches the spec's tab structure.
 */
export function CampaignsList({ templates }: Props) {
  const t = useTranslations("notifications");
  void templates;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">{t("campaigns.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("campaigns.subtitle")}
          </p>
        </div>
        <Button disabled>
          <PlusIcon className="size-4" />
          {t("campaigns.new")}
        </Button>
      </div>
      <EmptyState
        icon={<MegaphoneIcon />}
        title={t("campaigns.empty.title")}
        description={t("campaigns.empty.description")}
      />
    </div>
  );
}
