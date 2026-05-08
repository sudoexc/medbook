"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, ExternalLinkIcon, RotateCcwIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { formatDate, type Locale } from "@/lib/format";
import { defaultDeeplinkPath } from "@/lib/actions/types";
import {
  ACTION_ICONS,
  SEVERITY_BADGE_VARIANT,
  SEVERITY_BORDER_CLASS,
  SEVERITY_DOT_CLASS,
} from "@/lib/actions/icons";
import { formatActionBody, formatActionTitle } from "@/lib/actions/format";

import type { ActionRow } from "../_hooks/use-actions";
import {
  useDoneAction,
  useReopenAction,
} from "../_hooks/use-actions";
import { SnoozePopover } from "./snooze-popover";
import { DismissDialog } from "./dismiss-dialog";

export type ActionCardVariant = "full" | "compact";

export interface ActionCardProps {
  row: ActionRow;
  /**
   * Variant — "full" is the Action Center page card with rich layout and four
   * action buttons. "compact" is the briefing-tile variant: tight one-liner
   * with three inline actions (Open / Snooze / Done).
   */
  variant?: ActionCardVariant;
  /** When true, show only the Reopen button (DISMISSED / DONE tabs, admin). */
  showReopen?: boolean;
  /** Locale-prefixed deeplink helper — adds `/{locale}` to the action's path. */
  localePath?: (path: string) => string;
}

/**
 * Render one action as a card. Used by both surfaces; layout switches on
 * `variant`. We co-locate the click handlers here so each surface stays
 * declarative.
 */
export function ActionCard({
  row,
  variant = "full",
  showReopen = false,
  localePath,
}: ActionCardProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const tac = useTranslations("actionCenter");

  const done = useDoneAction();
  const reopen = useReopenAction();

  const Icon = ACTION_ICONS[row.type];
  const title = formatActionTitle(t, row.payload, locale);
  const body = formatActionBody(t, row.payload, locale);

  const deeplink =
    row.deeplinkPath && row.deeplinkPath.length > 0
      ? row.deeplinkPath
      : defaultDeeplinkPath(row.type);
  const href = localePath ? localePath(deeplink) : deeplink;

  const fireDone = async () => {
    try {
      await done.mutateAsync({ id: row.id });
      toast.success(tac("actions.doneSuccess"));
    } catch (e) {
      toast.error(
        tac("actions.doneError", {
          reason: e instanceof Error ? e.message : "Error",
        }),
      );
    }
  };

  const fireReopen = async () => {
    try {
      await reopen.mutateAsync({ id: row.id });
      toast.success(tac("actions.reopenSuccess"));
    } catch (e) {
      toast.error(
        tac("actions.reopenError", {
          reason: e instanceof Error ? e.message : "Error",
        }),
      );
    }
  };

  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border-l-4 border-y border-r border-border bg-card px-3 py-2",
          SEVERITY_BORDER_CLASS[row.severity],
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            SEVERITY_DOT_CLASS[row.severity],
          )}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Link
            href={href}
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "h-7 px-2 text-xs",
            )}
          >
            {tac("actions.open")}
          </Link>
          <SnoozePopover
            actionId={row.id}
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                aria-label={tac("actions.snooze")}
              >
                {tac("actions.snooze")}
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-success"
            onClick={() => void fireDone()}
            disabled={done.isPending}
          >
            <CheckIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "rounded-xl border-l-4 border-y border-r border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        SEVERITY_BORDER_CLASS[row.severity],
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              <Badge
                variant={SEVERITY_BADGE_VARIANT[row.severity]}
                className="text-[10px] uppercase tracking-wide"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    SEVERITY_DOT_CLASS[row.severity],
                  )}
                />
                {tac(`severity.${row.severity}`)}
              </Badge>
            </div>
            {body ? (
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>{formatDate(row.createdAt, locale, "relative")}</span>
              {row.status === "DISMISSED" && row.dismissedAt ? (
                <span>
                  {tac("attribution.dismissedAt", {
                    when: formatDate(row.dismissedAt, locale, "relative"),
                  })}
                </span>
              ) : null}
              {row.status === "DONE" && row.doneAt ? (
                <span>
                  {tac("attribution.doneAt", {
                    when: formatDate(row.doneAt, locale, "relative"),
                  })}
                </span>
              ) : null}
              {row.status === "SNOOZED" && row.snoozeUntil ? (
                <span>
                  {tac("attribution.snoozedUntil", {
                    when: formatDate(row.snoozeUntil, locale, "relative"),
                  })}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {showReopen ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => void fireReopen()}
              disabled={reopen.isPending}
            >
              <RotateCcwIcon className="size-3.5" />
              {tac("actions.reopen")}
            </Button>
          ) : (
            <>
              <Link
                href={href}
                className={cn(
                  buttonVariants({ variant: "default", size: "sm" }),
                  "h-8 gap-1.5 text-xs",
                )}
              >
                <ExternalLinkIcon className="size-3.5" />
                {tac("actions.open")}
              </Link>
              <SnoozePopover actionId={row.id} />
              <DismissDialog actionId={row.id} />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs text-success"
                onClick={() => void fireDone()}
                disabled={done.isPending}
              >
                <CheckIcon className="size-3.5" />
                {tac("actions.done")}
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
