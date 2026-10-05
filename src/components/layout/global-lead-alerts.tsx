"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

// Locale-aware router: pushes /crm/online-requests with the active locale.
import { useRouter } from "@/i18n/navigation";
import { useLiveEvents } from "@/hooks/use-live-events";
import { shellSummaryKey } from "@/hooks/use-shell-summary";
import { playNotificationSound } from "@/lib/notification-sound";
import { isReceptionTabletPath } from "@/lib/reception-tablet/access";

/**
 * Shell-level signal for booking requests from the public site (audit LD-01).
 *
 * A request used to land in the `Lead` table and stay there: no screen read
 * it and nobody was told, while the visitor had been promised a call back.
 * Now every `lead.created` pings the desk on whatever CRM screen it is on
 * (toast + sound + «Открыть»), and every lead event refreshes the sidebar
 * badge so the count of unanswered requests is always current.
 *
 * `canWork` is false for roles that do not process requests (nurse, doctor
 * in CRM): they still get the badge refresh (it reads 0 for them) but no
 * toast about work that is not theirs.
 *
 * Not on the reception iPad page: calling a site request back is desk work,
 * and the toast's «Открыть» would take the tablet away from the patient
 * being booked. The sidebar badge keeps counting.
 */
export function GlobalLeadAlerts({ canWork }: { canWork: boolean }) {
  const t = useTranslations("onlineRequests");
  const router = useRouter();
  const qc = useQueryClient();
  const onTablet = isReceptionTabletPath(usePathname());
  const onTabletRef = React.useRef(onTablet);
  React.useEffect(() => {
    onTabletRef.current = onTablet;
  }, [onTablet]);

  const handler = React.useCallback(
    (event: { type: string; payload?: unknown }) => {
      void qc.invalidateQueries({ queryKey: shellSummaryKey });
      if (event.type !== "lead.created" || !canWork || onTabletRef.current) return;
      const p = (event.payload ?? {}) as { name?: string };
      playNotificationSound();
      toast.info(t("toast.title"), {
        description: p.name?.trim() || t("toast.noName"),
        duration: 15_000,
        action: {
          label: t("toast.open"),
          onClick: () => router.push("/crm/online-requests"),
        },
      });
    },
    [canWork, qc, router, t],
  );

  useLiveEvents(handler, { filter: ["lead.created", "lead.updated"] });
  return null;
}
