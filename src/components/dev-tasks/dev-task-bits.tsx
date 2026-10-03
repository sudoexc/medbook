"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  devTaskAge,
  type DevTaskPriority,
  type DevTaskStatus,
} from "@/lib/dev-tasks";

/** Colour = state (DESIGN-DOCTRINE): the same badge variants the CRM uses. */
const STATUS_VARIANT: Record<DevTaskStatus, React.ComponentProps<typeof Badge>["variant"]> = {
  NEW: "violet",
  IN_PROGRESS: "info",
  DONE: "success",
  CANCELLED: "muted",
};

const PRIORITY_VARIANT: Record<DevTaskPriority, React.ComponentProps<typeof Badge>["variant"]> = {
  NORMAL: "muted",
  HIGH: "warning",
  URGENT: "destructive",
};

export function DevTaskStatusChip({ status }: { status: DevTaskStatus }) {
  const t = useTranslations("devTasks.status");
  return <Badge variant={STATUS_VARIANT[status]}>{t(status)}</Badge>;
}

/**
 * Only «Важная» and «Срочная» get a chip on cards (`quiet`): a grey
 * «Обычная» on every card would be noise that hides the two that matter.
 * The drawer shows the chip for every level.
 */
export function DevTaskPriorityChip({
  priority,
  quiet = false,
}: {
  priority: DevTaskPriority;
  quiet?: boolean;
}) {
  const t = useTranslations("devTasks.priority");
  if (quiet && priority === "NORMAL") return null;
  return (
    <Badge
      variant={PRIORITY_VARIANT[priority]}
      // The warning variant's text is the white foreground, unreadable on
      // its pale fill; the dark amber text token reads on both themes.
      className={priority === "HIGH" ? "text-warning-text" : undefined}
    >
      {t(priority)}
    </Badge>
  );
}

/** «3 ч назад», refreshed with the board's own polling. */
export function useDevTaskAgeLabel() {
  const t = useTranslations("devTasks.age");
  return React.useCallback(
    (iso: string) => {
      const age = devTaskAge(iso);
      return age.unit === "now" ? t("now") : t(age.unit, { value: age.value });
    },
    [t],
  );
}
