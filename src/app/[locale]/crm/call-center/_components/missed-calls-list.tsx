"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckIcon, PhoneMissedIcon } from "lucide-react";

import { EmptyState } from "@/components/atoms/empty-state";
import { Button } from "@/components/ui/button";
import { isCalledBack } from "@/lib/calls/call-state";

import type { CallRow } from "../_hooks/types";
import { useMarkCalledBack } from "../_hooks/use-missed-calls";
import { CallBubble } from "./call-bubble";
import { CallsErrorState } from "./calls-error-state";

/**
 * Left column, «Пропущенные» tab (audit CM-13): today's missed calls, the
 * ones still waiting for a call back first. Picking a row opens the caller
 * in the middle column (patient, next visit, «Записать»); «Перезвонил»
 * marks the call handled, which takes it off the sidebar badge.
 */
export function MissedCallsList({
  rows,
  selectedId,
  onSelect,
  isLoading,
  error,
}: {
  rows: CallRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
  error?: Error | null;
}) {
  const t = useTranslations("callCenter.missed");
  const markCalledBack = useMarkCalledBack();

  // Waiting for a call back first, then the handled ones; newest first in
  // each group (the API order).
  const ordered = React.useMemo(
    () => [
      ...rows.filter((r) => !isCalledBack(r.tags)),
      ...rows.filter((r) => isCalledBack(r.tags)),
    ],
    [rows],
  );

  const onCalledBack = async (id: string) => {
    try {
      await markCalledBack.mutateAsync(id);
      toast.success(t("calledBackToast"));
    } catch {
      toast.error(t("calledBackFailed"));
    }
  };

  // A failed refresh keeps the list it already has; only a list that never
  // loaded is replaced by the error.
  if (error && rows.length === 0) {
    return <CallsErrorState error={error} />;
  }
  if (isLoading && rows.length === 0) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">{t("loading")}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-3 py-6">
        <EmptyState
          icon={<PhoneMissedIcon />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          className="border-none bg-transparent px-2 py-4"
        />
      </div>
    );
  }
  return (
    <ul className="grid gap-1" aria-label={t("ariaLabel")}>
      {ordered.map((row) => {
        const done = isCalledBack(row.tags);
        return (
          <li key={row.id} className="rounded-md">
            <CallBubble
              row={row}
              onClick={() => onSelect(row.id)}
              selected={row.id === selectedId}
            />
            <div className="flex justify-end px-3 pb-1.5">
              {done ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  <CheckIcon className="size-3" aria-hidden />
                  {t("calledBack")}
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[11px]"
                  disabled={markCalledBack.isPending}
                  onClick={() => void onCalledBack(row.id)}
                >
                  <CheckIcon className="size-3.5" aria-hidden />
                  {t("markCalledBack")}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
