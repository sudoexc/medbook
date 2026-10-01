"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangleIcon, LinkIcon, ZapIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/atoms/empty-state";
import { cn } from "@/lib/utils";

import { useToggleTrigger, useTriggers } from "../_hooks/use-triggers";

// Labels and timings come from the event catalog the dispatcher reads
// (audit TG-25); they used to be hard-coded English strings («09:00 clinic
// TZ», «-2h» for a band that is no longer sent).
export function TriggersPanel() {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const query = useTriggers();
  const toggleMut = useToggleTrigger();

  const onToggle = async (event: string, hasTemplate: boolean, current: boolean) => {
    if (!hasTemplate) {
      toast.info(t("triggers.noTemplate"));
      return;
    }
    try {
      await toggleMut.mutateAsync({ event, enabled: !current });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ZapIcon className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">{t("triggers.title")}</h3>
      </div>
      <p className="text-xs text-muted-foreground">{t("triggers.hint")}</p>

      {query.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (query.data?.rows ?? []).length === 0 ? (
        <EmptyState
          title={t("triggers.empty.title")}
          description={t("triggers.empty.description")}
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {(query.data?.rows ?? []).map((row) => {
            const linked = Boolean(row.template);
            const templateName =
              locale === "uz" ? row.template?.nameUz : row.template?.nameRu;
            return (
              <li
                key={row.key}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">
                      {t(`triggers.events.${row.label}`)}
                    </span>
                    <Badge variant="muted">
                      {t(`triggers.timing.${row.timing}`, row.timingValues)}
                    </Badge>
                  </div>
                  <div
                    className={cn(
                      "mt-0.5 text-sm",
                      !linked
                        ? "text-destructive"
                        : row.active
                          ? "text-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {!linked ? (
                      <span className="flex items-center gap-1">
                        <AlertTriangleIcon className="size-3.5" />
                        {t("triggers.needTemplate")}
                      </span>
                    ) : row.active ? (
                      <span className="flex items-center gap-1">
                        <LinkIcon className="size-3.5" />
                        {templateName}
                        <Badge variant="outline" className="ml-1">
                          {row.template?.channel}
                        </Badge>
                      </span>
                    ) : (
                      t("triggers.templateOff", { name: templateName ?? "" })
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {row.active ? t("triggers.on") : t("triggers.off")}
                  </span>
                  <Switch
                    checked={row.active}
                    disabled={!linked || toggleMut.isPending}
                    onCheckedChange={() => onToggle(row.key, linked, row.active)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
