"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CalendarClockIcon,
  CheckIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { actionsForMany } from "@/lib/appointment-transitions";
import {
  AppointmentConflictError,
  useBulkStatus,
} from "../_hooks/use-appointment";
import type { AppointmentRow } from "../_hooks/use-appointments-list";
import { BulkRescheduleDialog } from "./bulk-reschedule-dialog";

export interface AppointmentsBulkBarProps {
  selectedIds: string[];
  rows: AppointmentRow[];
  onClear: () => void;
  className?: string;
}

/**
 * Sticky bulk-actions bar: appears when ≥1 row is selected.
 *
 * Actions:
 *  - «Пришёл» → bulk set queueStatus=WAITING (via POST /bulk-status)
 *  - «Не пришёл» → bulk set status=NO_SHOW
 *  - «Перенести» → placeholder (calc dialog lives in the calendar specialist)
 */
export function AppointmentsBulkBar({
  selectedIds,
  rows,
  onClear,
  className,
}: AppointmentsBulkBarProps) {
  const t = useTranslations("appointments.bulk");
  const tConflict = useTranslations("appointments.drawer.conflict");
  const mutation = useBulkStatus();

  const onMutationError = React.useCallback(
    (err: Error) => {
      if (err instanceof AppointmentConflictError) {
        toast.error(
          tConflict(err.conflict.reason, { until: err.conflict.until ?? "" }),
        );
      } else {
        toast.error(err.message || t("error"));
      }
    },
    [tConflict, t],
  );

  const count = selectedIds.length;
  const selectedSet = React.useMemo(
    () => new Set(selectedIds),
    [selectedIds],
  );
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);

  // Action availability is the intersection across all selected rows: a
  // button is enabled only if EVERY selected row allows it.
  const actions = React.useMemo(() => {
    const statuses = rows
      .filter((r) => selectedSet.has(r.id))
      .map((r) => r.status);
    return actionsForMany(statuses);
  }, [rows, selectedSet]);

  const markArrived = () => {
    if (!actions.canMarkArrived) return;
    mutation.mutate(
      { ids: selectedIds, status: "WAITING" },
      {
        onSuccess: ({ count }) => {
          toast.success(t("markedArrived", { count }));
          onClear();
        },
        onError: onMutationError,
      },
    );
  };

  const markNoShow = () => {
    if (!actions.canMarkNoShow) return;
    mutation.mutate(
      { ids: selectedIds, status: "NO_SHOW" },
      {
        onSuccess: ({ count }) => {
          toast.success(t("markedNoShow", { count }));
          onClear();
        },
        onError: onMutationError,
      },
    );
  };

  if (count === 0) return null;

  return (
    <TooltipProvider>
      <div
        role="toolbar"
        aria-label={t("label")}
        className={cn(
          "sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm",
          className,
        )}
      >
        <span className="text-sm font-medium text-foreground">
          {t("selected", { count })}
        </span>

        <div className="mx-2 h-5 w-px bg-border" aria-hidden />

        <BulkActionButton
          icon={<CheckIcon className="size-4" />}
          label={t("markArrived")}
          onClick={markArrived}
          disabled={mutation.isPending || !actions.canMarkArrived}
          disabledReason={
            !actions.canMarkArrived ? t("disabled.markArrived") : undefined
          }
        />

        <BulkActionButton
          icon={<UserXIcon className="size-4" />}
          label={t("markNoShow")}
          onClick={markNoShow}
          disabled={mutation.isPending || !actions.canMarkNoShow}
          disabledReason={
            !actions.canMarkNoShow ? t("disabled.markNoShow") : undefined
          }
        />

        <BulkActionButton
          icon={<CalendarClockIcon className="size-4" />}
          label={t("reschedule")}
          onClick={() => setRescheduleOpen(true)}
          disabled={mutation.isPending || !actions.canReschedule}
          disabledReason={
            !actions.canReschedule ? t("disabled.reschedule") : undefined
          }
        />

        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
          className="ml-auto"
          aria-label={t("clearSelection")}
        >
          <XIcon className="size-4" />
          {t("clear")}
        </Button>
      </div>

      <BulkRescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        selectedIds={selectedIds}
        onCompleted={() => onClear()}
      />
    </TooltipProvider>
  );
}

/**
 * Action button that wraps in a tooltip explaining why it's disabled when
 * the row selection has incompatible statuses. Without this users wonder
 * why "Не пришёл" is greyed out for a patient already on приёме.
 */
function BulkActionButton({
  icon,
  label,
  onClick,
  disabled,
  disabledReason,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  disabledReason?: string;
}) {
  const button = (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </Button>
  );
  if (!disabled || !disabledReason) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{button}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
