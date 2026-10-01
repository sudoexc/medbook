"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Locale-aware router: pushes /crm/reception with the active locale.
import { useRouter } from "@/i18n/navigation";
import { useLiveEvents } from "@/hooks/use-live-events";
import { deskHasReacted } from "@/lib/appointments/self-check-in";
import { playNotificationSound } from "@/lib/notification-sound";

/** One alert per visit: a repeated event replaces it instead of stacking. */
function alertId(appointmentId: string): string {
  return `self-check-in:${appointmentId}`;
}

/**
 * Mini App «Я на месте» on every CRM screen, until someone reacts (audit
 * G3-01).
 *
 * The check-in used to show a four-second toast mounted on the reception page
 * only: a receptionist on «Записи», on a call or away from the desk never saw
 * it, the patient waited in the hall as the app had told him to, and the
 * sweep later marked him a no-show. Now the alert lives in the CRM layout,
 * rings once, and stays until it is dismissed, opened, or the visit moves on
 * («Пришёл», cancelled, ...), whichever comes first. The booking keeps its
 * «Отметился в приложении» badge on the lists in the meantime.
 *
 * Mounted for the roles that check patients in (`canWork`).
 */
export function GlobalArrivalAlerts({ canWork }: { canWork: boolean }) {
  const t = useTranslations("reception.live");
  const router = useRouter();

  const handler = React.useCallback(
    (event: { type: string; payload?: unknown }) => {
      const p = (event.payload ?? {}) as {
        appointmentId?: string;
        patientName?: string;
        time?: string;
        status?: string | null;
        queueStatus?: string;
      };
      if (!p.appointmentId) return;
      if (event.type !== "patient.arrived") {
        // The desk marked the patient arrived, or the visit ended another
        // way: the alert has done its job.
        if (deskHasReacted(p.queueStatus ?? p.status)) {
          toast.dismiss(alertId(p.appointmentId));
        }
        return;
      }
      const appointmentId = p.appointmentId;
      const name = p.patientName?.trim() || t("fallbackName");
      playNotificationSound();
      toast.warning(t("selfCheckInTitle"), {
        id: alertId(appointmentId),
        description: p.time ? `${name} · ${p.time}` : name,
        // Until a person reacts: the patient is waiting to be met.
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: t("open"),
          onClick: () =>
            router.push(
              `/crm/reception?ap=${encodeURIComponent(appointmentId)}`,
            ),
        },
        cancel: {
          label: t("dismiss"),
          onClick: () => undefined,
        },
      });
    },
    [router, t],
  );

  useLiveEvents(handler, {
    filter: ["patient.arrived", "appointment.statusChanged", "queue.updated"],
    enabled: canWork,
  });
  return null;
}
