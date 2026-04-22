"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BellIcon,
  GiftIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { Template } from "../_hooks/use-templates";
import type { TemplateCategory } from "../_hooks/types";

type Props = {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  isLoading: boolean;
};

const CATEGORY_ICON: Record<TemplateCategory, React.ComponentType<{ className?: string }>> = {
  REMINDER: BellIcon,
  MARKETING: MegaphoneIcon,
  TRANSACTIONAL: SparklesIcon,
};

function groupByCategory(tpls: Template[]): Record<TemplateCategory, Template[]> {
  const g: Record<TemplateCategory, Template[]> = {
    REMINDER: [],
    MARKETING: [],
    TRANSACTIONAL: [],
  };
  for (const t of tpls) {
    if (t.category in g) g[t.category as TemplateCategory].push(t);
  }
  return g;
}

export function TemplateTree({ templates, selectedId, onSelect, isLoading }: Props) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const groups = React.useMemo(() => groupByCategory(templates), [templates]);

  return (
    <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("tree.title")}</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onSelect(null)}
          aria-label={t("tree.new")}
        >
          <PlusIcon className="size-4" />
          {t("tree.new")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {isLoading ? (
          <>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-full" />
          </>
        ) : (
          (Object.keys(groups) as TemplateCategory[]).map((cat) => {
            const items = groups[cat];
            const Icon = CATEGORY_ICON[cat];
            return (
              <div key={cat}>
                <div className="mb-1 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="size-3.5" />
                  {t(`categories.${cat}`)}
                </div>
                {items.length === 0 ? (
                  <div className="rounded-md px-2 py-1 text-xs text-muted-foreground">
                    {t("tree.empty")}
                  </div>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {items.map((tpl) => {
                      const active = tpl.id === selectedId;
                      return (
                        <li key={tpl.id}>
                          <button
                            type="button"
                            onClick={() => onSelect(tpl.id)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                              active
                                ? "bg-primary/10 text-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            <MessageSquareIcon
                              className={cn(
                                "size-3.5 shrink-0",
                                tpl.channel === "TG"
                                  ? "text-[color:var(--info)]"
                                  : "text-muted-foreground",
                              )}
                            />
                            <span className="truncate">
                              {locale === "uz" ? tpl.nameUz : tpl.nameRu}
                            </span>
                            {!tpl.isActive ? (
                              <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t("tree.disabled")}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })
        )}

        {/* Birthdays / custom groups purely visual for now */}
        <div className="border-t border-border pt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 px-1">
            <GiftIcon className="size-3.5" />
            {t("tree.customs")}
          </div>
        </div>
      </div>
    </div>
  );
}
