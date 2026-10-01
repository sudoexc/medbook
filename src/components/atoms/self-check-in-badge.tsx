"use client";

import { SmartphoneIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { formatDate } from "@/lib/format";
import { awaitsDeskCheckIn } from "@/lib/appointments/self-check-in";
import { cn } from "@/lib/utils";

/**
 * «Отметился в приложении · 14:05» (audit G3-01): the patient pressed «Я на
 * месте» in the Mini App and the desk has not marked him «Пришёл» yet. Shown
 * on every reception list and on the appointment card until then; renders
 * nothing for any other row, so callers can drop it in unconditionally.
 */
export function SelfCheckInBadge({
  row,
  className,
}: {
  row: {
    arrivedAt?: string | Date | null;
    status: string;
    queueStatus?: string | null;
  };
  className?: string;
}) {
  const t = useTranslations("reception.live");
  const locale = useLocale() === "uz" ? "uz" : "ru";
  if (!awaitsDeskCheckIn(row) || !row.arrivedAt) return null;
  const time = formatDate(row.arrivedAt, locale, "time");
  const label = time
    ? t("selfCheckInBadgeAt", { time })
    : t("selfCheckInBadge");
  return (
    <span
      title={t("selfCheckInHint")}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 text-[11px] font-medium text-warning-text",
        className,
      )}
    >
      <SmartphoneIcon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
