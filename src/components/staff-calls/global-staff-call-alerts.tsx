"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRingIcon, FootprintsIcon } from "lucide-react";

import { STAFF_CALL_RING_EVERY_MS, type StaffCallView } from "@/lib/staff-calls";
import { playNotificationSound } from "@/lib/notification-sound";

import { StaffCallClosedError, useOpenStaffCalls } from "./use-staff-calls";

/**
 * A doctor calling the desk, full screen on every reception screen (owner
 * request 09.10.2026): the desk PC and the iPad (its page sits under this
 * layer). It rings at once and again every STAFF_CALL_RING_EVERY_MS until
 * someone answers «Иду»; that answer closes it on every screen and shows
 * the doctor who is coming. Mounted in the CRM layout for the desk and the
 * nurse (`enabled`).
 */
export function GlobalStaffCallAlerts({ enabled }: { enabled: boolean }) {
  const t = useTranslations("staffCall");
  const { query, ack } = useOpenStaffCalls(enabled);

  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  // The server lists only calls still ringing, by its own clock; this PC's
  // clock is used for nothing but «N мин назад», corrected by the skew.
  const calls = React.useMemo(
    () => (query.data?.value ?? []).filter((c) => c.status === "OPEN"),
    [query.data],
  );
  const serverNow = now + (query.data?.skewMs ?? 0);

  // Ring for a new call at once, then again while any call is open.
  const rung = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (calls.some((c) => !rung.current.has(c.id))) playNotificationSound();
    rung.current = new Set(calls.map((c) => c.id));
  }, [calls]);
  const open = calls.length > 0;
  React.useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => playNotificationSound(), STAFF_CALL_RING_EVERY_MS);
    return () => window.clearInterval(id);
  }, [open]);

  if (!enabled || !open || typeof document === "undefined") return null;

  const answer = (c: StaffCallView) =>
    ack.mutate(c.id, {
      onError: (e) => {
        if (e instanceof StaffCallClosedError) {
          const who = e.call?.status === "ACKED" ? e.call.ackedByName : null;
          toast.info(who ? t("alreadyGoing", { name: who }) : t("closed"));
        } else {
          toast.error(t("ackFailed"));
        }
      },
    });

  // A portal straight into <body>, mounted when the call comes in, and
  // presses kept to itself: a desk dialog left open (a booking, a payment)
  // must not take «Иду» for a click outside it and close with what was
  // typed in it (review 09.10.2026). Its dismiss logic ignores layers
  // added after it opened, and the stopped events never reach it.
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={t("overlayTitle")}
      onPointerDown={keep}
      onMouseDown={keep}
      onTouchStart={keep}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6"
    >
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto">
        {calls.map((c) => {
          const min = Math.max(0, Math.floor((serverNow - new Date(c.createdAt).getTime()) / 60_000));
          const pending = ack.isPending && ack.variables === c.id;
          return (
            <div
              key={c.id}
              className="flex flex-col items-center gap-5 rounded-3xl border-4 border-warning bg-card px-8 py-10 text-center shadow-2xl"
            >
              <span className="flex size-20 items-center justify-center rounded-full bg-warning/15 text-warning-text">
                <BellRingIcon className="size-10 animate-pulse" aria-hidden />
              </span>
              <div>
                <p className="text-2xl font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("overlayTitle")}
                </p>
                <p className="mt-2 text-4xl font-bold leading-tight text-foreground">{c.doctorName}</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {c.cabinet ? t("cabinet", { number: c.cabinet }) : null}
                  {c.cabinet ? " · " : null}
                  <span className="text-muted-foreground">
                    {min === 0 ? t("justNow") : t("ago", { min })}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => answer(c)}
                disabled={pending}
                className="motion-press inline-flex h-20 w-full max-w-md select-none items-center justify-center gap-3 rounded-3xl bg-success px-8 text-3xl font-bold text-success-foreground shadow-lg transition-colors active:bg-success/85 disabled:opacity-70"
              >
                <FootprintsIcon className="size-8" aria-hidden />
                {t("go")}
              </button>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
