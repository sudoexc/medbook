"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import type { PendingReschedule } from "./calendar-view";

/**
 * Phase 12 Wave 3 — confirmation modal for drag-rescheduled appointments.
 *
 * The drag interaction lives inside FullCalendar; on drop the calendar
 * surfaces a `PendingReschedule` to the page-level state. This component
 * renders the «Перенести запись?» prompt and calls back into the pending
 * record's `confirm` / `revert` closures so cancellation rolls back the
 * optimistic visual move.
 */
export function RescheduleConfirmDialog({
  pending,
  onClose,
}: {
  pending: PendingReschedule | null;
  onClose: () => void;
}) {
  const t = useTranslations("calendar.reschedule");
  const locale = useLocale();
  const open = pending !== null;

  // Format "HH:mm DD.MM" so the prompt reads naturally in both locales
  // without pulling in date-fns. Locale-aware via Intl.
  const newSlotLabel = React.useMemo(() => {
    if (!pending) return "";
    const fmt = new Intl.DateTimeFormat(locale === "uz" ? "uz-Latn-UZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
    return fmt.format(pending.newStart);
  }, [pending, locale]);

  const handleConfirm = () => {
    pending?.confirm();
    onClose();
  };

  const handleCancel = () => {
    pending?.revert();
    onClose();
  };

  // Radix calls onOpenChange(false) on Esc / overlay-click as well as the
  // Cancel button — route every "close without confirming" through revert.
  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && pending) handleCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {pending
              ? t("confirmBody", {
                  patient: pending.patientName,
                  time: newSlotLabel,
                  doctor: pending.doctorName || "—",
                })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={handleCancel}>
            {t("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>
            {t("confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
