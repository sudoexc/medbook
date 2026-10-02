"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

type RemindersResult = {
  requested: number;
  scoped: number;
  reminded: number;
  skipped: number;
  noChannel: number;
  templateDisabled: boolean;
};

/**
 * «Напомнить» for a set of visits: POST /api/crm/appointments/bulk-reminders
 * and a toast that reports what really happened. Shared by the «Записи» rail
 * and the reception's «Напоминания пациентам» card, whose «Отправить» used to
 * open the Action Center and send nothing (audit AP-14).
 */
export function useBulkReminders(): {
  send: (ids: string[]) => void;
  isPending: boolean;
} {
  const t = useTranslations("appointments");
  const mutation = useMutation<RemindersResult, Error, { ids: string[] }>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/crm/appointments/bulk-reminders`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appointmentIds: input.ids }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; reason?: string }
          | null;
        throw new Error(data?.reason ?? data?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as RemindersResult;
    },
    // The toast reports what really happened: patients reminded, not queue
    // rows (each reminder also has an in-app mirror), and who could not be
    // reached at all (AP-02).
    onSuccess: (result) => {
      const noChannel =
        result.noChannel > 0
          ? t("rail.remindersNoChannel", { count: result.noChannel })
          : undefined;
      if (result.templateDisabled) {
        toast.info(t("rail.remindersTemplateOff"));
      } else if (result.reminded > 0) {
        toast.success(t("rail.remindersSent", { count: result.reminded }), {
          description: noChannel,
        });
      } else if (result.noChannel > 0) {
        toast.info(noChannel);
      } else if (result.skipped > 0) {
        toast.info(t("rail.remindersAllSkipped"));
      } else {
        toast.info(t("rail.remindersNothing"));
      }
    },
    // The localized line only: the server's code («Forbidden», «HTTP 429»)
    // means nothing to the desk (AP-18).
    onError: () => {
      toast.error(t("rail.remindersFailed"));
    },
  });

  const { mutate } = mutation;
  const send = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        toast.info(t("rail.remindersNothing"));
        return;
      }
      mutate({ ids });
    },
    [mutate, t],
  );

  return { send, isPending: mutation.isPending };
}
