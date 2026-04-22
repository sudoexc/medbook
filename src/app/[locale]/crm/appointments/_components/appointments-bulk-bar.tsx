"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CalendarClockIcon,
  CheckIcon,
  SendIcon,
  UserXIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  useBulkStatus,
} from "../_hooks/use-appointment";
import type { AppointmentRow } from "../_hooks/use-appointments-list";

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
 *  - «SMS напоминание» → POST /api/crm/communications/sms for each row (stub)
 */
export function AppointmentsBulkBar({
  selectedIds,
  rows,
  onClear,
  className,
}: AppointmentsBulkBarProps) {
  const t = useTranslations("appointments.bulk");
  const mutation = useBulkStatus();
  const [sending, setSending] = React.useState(false);

  const count = selectedIds.length;
  const selectedSet = React.useMemo(
    () => new Set(selectedIds),
    [selectedIds],
  );

  const markArrived = () => {
    mutation.mutate(
      { ids: selectedIds, status: "WAITING" },
      {
        onSuccess: ({ count }) => {
          toast.success(t("markedArrived", { count }));
          onClear();
        },
      },
    );
  };

  const markNoShow = () => {
    mutation.mutate(
      { ids: selectedIds, status: "NO_SHOW" },
      {
        onSuccess: ({ count }) => {
          toast.success(t("markedNoShow", { count }));
          onClear();
        },
      },
    );
  };

  const sendSms = async () => {
    setSending(true);
    let ok = 0;
    let fail = 0;
    // Fan-out one POST per selected row. 409/500 → count as fail, continue.
    const targets = rows.filter((r) => selectedSet.has(r.id));
    for (const row of targets) {
      try {
        const res = await fetch(`/api/crm/communications/sms`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId: row.patient.id,
            text: t("smsTemplate", {
              time: row.time ?? "",
              doctor: row.doctor.nameRu,
            }),
          }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setSending(false);
    if (ok > 0) toast.success(t("smsSent", { count: ok }));
    if (fail > 0) toast.error(t("smsFailed", { count: fail }));
    onClear();
  };

  if (count === 0) return null;

  return (
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

      <Button
        size="sm"
        variant="outline"
        onClick={markArrived}
        disabled={mutation.isPending}
      >
        <CheckIcon className="size-4" />
        {t("markArrived")}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={markNoShow}
        disabled={mutation.isPending}
      >
        <UserXIcon className="size-4" />
        {t("markNoShow")}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={() => toast.info(t("rescheduleStub"))}
        disabled={mutation.isPending}
      >
        <CalendarClockIcon className="size-4" />
        {t("reschedule")}
      </Button>

      <Button
        size="sm"
        variant="outline"
        onClick={sendSms}
        disabled={sending}
      >
        <SendIcon className="size-4" />
        {t("sendSms")}
      </Button>

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
  );
}
