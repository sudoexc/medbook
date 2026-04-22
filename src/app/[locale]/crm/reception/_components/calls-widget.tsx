"use client";

import * as React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLinkIcon, PhoneIcon, PhoneIncomingIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { PhoneText } from "@/components/atoms/phone-text";
import { StatusDot } from "@/components/atoms/status-dot";

import type { CallRow } from "../_hooks/use-reception-live";

export interface CallsWidgetProps {
  rows: CallRow[];
  isLoading: boolean;
  onQuickAppointment: (prefill: {
    patientId: string | null;
    phone: string | null;
  }) => void;
  className?: string;
}

/**
 * Right-rail "Call-центр" preview per TZ §6.1.4(A).
 *
 * Shows the most recent 5 incoming calls. The "accept" / "quick appointment"
 * CTAs are functional stubs — they flip the card open or seed the
 * `NewAppointmentDialog` with the caller's phone. A full SIP-driven inline
 * answer UI ships with the dedicated `/crm/call-center` screen (Phase 3c).
 *
 * TODO(realtime-engineer): invalidate on `call.incoming` events so the ring
 * animation triggers inside 500 ms.
 * TODO(api-builder): `/api/crm/calls/active` endpoint — right now we filter
 * client-side for `endedAt == null`.
 */
export function CallsWidget({
  rows,
  isLoading,
  onQuickAppointment,
  className,
}: CallsWidgetProps) {
  const t = useTranslations("reception.calls");

  // Live calls (endedAt null) take priority; fall back to last 5 records.
  const active = rows.filter((c) => !c.endedAt).slice(0, 3);
  const recent = rows.filter((c) => c.endedAt).slice(0, 5 - active.length);
  const visible = [...active, ...recent];

  return (
    <section
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <PhoneIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <StatusDot status="online" size="xs" />
            {t("statusOnline")}
          </span>
        </div>
        <Link
          href="/crm/call-center"
          className={cn(
            buttonVariants({ variant: "ghost", size: "icon-sm" }),
          )}
          aria-label={t("openFull")}
          title={t("openFull")}
        >
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </header>

      <div className="p-3">
        {isLoading ? (
          <ul className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <li
                key={i}
                className="h-14 animate-pulse rounded-md bg-muted"
                aria-hidden
              />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-md border border-dashed border-border bg-card/40 px-3 py-6 text-center">
            <PhoneIcon className="size-5 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium text-foreground">{t("empty")}</p>
            <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((row) => (
              <CallItem
                key={row.id}
                row={row}
                onQuickAppointment={onQuickAppointment}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function CallItem({
  row,
  onQuickAppointment,
}: {
  row: CallRow;
  onQuickAppointment: CallsWidgetProps["onQuickAppointment"];
}) {
  const t = useTranslations("reception.calls");
  const isLive = !row.endedAt;
  return (
    <li
      className={cn(
        "rounded-md border p-2 text-sm",
        isLive
          ? "animate-[pulse_2s_ease-in-out_infinite] border-primary/50 bg-primary/5"
          : "border-border bg-background",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-full",
            row.direction === "MISSED"
              ? "bg-destructive/10 text-destructive"
              : "bg-info/15 text-[color:var(--info)]",
          )}
        >
          <PhoneIncomingIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {row.patient?.fullName ?? t("unknownCaller")}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <PhoneText phone={row.fromNumber} asText />
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {row.direction === "IN"
            ? t("directionIN")
            : row.direction === "OUT"
              ? t("directionOUT")
              : t("directionMISSED")}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <Link
          href="/crm/call-center"
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "flex-1 justify-center",
          )}
        >
          {t("accept")}
        </Link>
        <Button
          size="sm"
          variant="secondary"
          className="flex-1"
          onClick={() =>
            onQuickAppointment({
              patientId: row.patient?.id ?? null,
              phone: row.fromNumber,
            })
          }
        >
          {t("quickAppointment")}
        </Button>
      </div>
    </li>
  );
}
