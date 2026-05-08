"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ClockIcon } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";

import { useSnoozeAction } from "../_hooks/use-actions";

export type SnoozePreset = "1h" | "4h" | "tomorrow" | "next-week";

export interface SnoozePopoverProps {
  actionId: string;
  /** Optional render-prop trigger; defaults to a small ghost button with clock icon. */
  trigger?: React.ReactNode;
  /** Called after a successful snooze (used by callers to close menus). */
  onSnoozed?: () => void;
}

/**
 * Reusable snooze popover used by both the Action Center page and the
 * reception briefing card. Four preset buttons + an "Other..." inline
 * datetime-local input that submits an explicit `until` ISO.
 *
 * The mutation runs optimistically — the row disappears from the OPEN list
 * the instant the user clicks. On error we surface a toast and the
 * tanstack invalidation refetches the source of truth.
 */
export function SnoozePopover({
  actionId,
  trigger,
  onSnoozed,
}: SnoozePopoverProps) {
  const t = useTranslations("actionCenter");
  const [open, setOpen] = React.useState(false);
  const [showCustom, setShowCustom] = React.useState(false);
  const [customAt, setCustomAt] = React.useState<string>(""); // yyyy-MM-ddTHH:mm
  const snooze = useSnoozeAction();

  const close = React.useCallback(() => {
    setOpen(false);
    setShowCustom(false);
    setCustomAt("");
  }, []);

  const fireSnooze = React.useCallback(
    async (
      params: { preset: SnoozePreset } | { until: string },
      label: string,
    ) => {
      try {
        await snooze.mutateAsync({ id: actionId, ...params });
        toast.success(t("snooze.success", { until: label }));
        close();
        onSnoozed?.();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error";
        toast.error(t("snooze.error", { reason: msg }));
      }
    },
    [snooze, actionId, t, close, onSnoozed],
  );

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAt) return;
    const iso = new Date(customAt).toISOString();
    void fireSnooze({ until: iso }, customAt.replace("T", " "));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs"
            aria-label={t("actions.snooze")}
          >
            <ClockIcon className="size-3.5" />
            {t("actions.snooze")}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("snooze.title")}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={snooze.isPending}
            onClick={() => void fireSnooze({ preset: "1h" }, t("snooze.oneHour"))}
          >
            {t("snooze.oneHour")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={snooze.isPending}
            onClick={() => void fireSnooze({ preset: "4h" }, t("snooze.fourHours"))}
          >
            {t("snooze.fourHours")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={snooze.isPending}
            onClick={() =>
              void fireSnooze({ preset: "tomorrow" }, t("snooze.tomorrow"))
            }
          >
            {t("snooze.tomorrow")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={snooze.isPending}
            onClick={() =>
              void fireSnooze({ preset: "next-week" }, t("snooze.nextWeek"))
            }
          >
            {t("snooze.nextWeek")}
          </Button>
        </div>
        {!showCustom ? (
          <button
            type="button"
            className="mt-2 w-full rounded-md py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setShowCustom(true)}
          >
            {t("snooze.custom")}
          </button>
        ) : (
          <form onSubmit={submitCustom} className="mt-2 space-y-2">
            <Label
              htmlFor={`snooze-${actionId}-custom`}
              className="text-xs text-muted-foreground"
            >
              {t("snooze.untilLabel")}
            </Label>
            <Input
              id={`snooze-${actionId}-custom`}
              type="datetime-local"
              value={customAt}
              onChange={(e) => setCustomAt(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!customAt || snooze.isPending}
              className="w-full"
            >
              {t("snooze.confirm")}
            </Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
