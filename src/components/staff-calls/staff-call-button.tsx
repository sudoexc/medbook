"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BellRingIcon, CheckCircle2Icon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { STAFF_CALL_ACK_SHOWN_MS, doctorCallState } from "@/lib/staff-calls";
import { playNotificationSound } from "@/lib/notification-sound";

import { useMyStaffCall } from "./use-staff-calls";

/**
 * «Позвать регистратуру» in the doctor's top bar (owner request
 * 09.10.2026): one press calls the desk (the receptionist or the nurse),
 * whose screens show it full screen. While it rings the button says so and
 * can take it back; once someone answers «Иду» it shows who is coming.
 */
export function StaffCallButton() {
  const t = useTranslations("staffCall");
  const { query, call, cancel } = useMyStaffCall();
  const current = query.data?.value ?? null;
  const skewMs = query.data?.skewMs ?? 0;

  // Re-evaluate the state as time passes (ringing ends, «идёт» fades).
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);
  // When this screen first saw the answer, per call: the toast and sound
  // once, then «Идёт к вам» for STAFF_CALL_ACK_SHOWN_MS.
  const [seen, setSeen] = React.useState<{ id: string; at: number } | null>(null);
  React.useEffect(() => {
    if (current?.status !== "ACKED" || seen?.id === current.id) return;
    setSeen({ id: current.id, at: Date.now() });
    // A reload within the server's two minutes must not announce it again.
    const key = "staff-call:announced";
    try {
      if (window.sessionStorage.getItem(key) === current.id) return;
      window.sessionStorage.setItem(key, current.id);
    } catch {
      // Storage off: announcing twice is the lesser harm.
    }
    playNotificationSound();
    toast.success(
      current.ackedByName ? t("coming", { name: current.ackedByName }) : t("comingNoName"),
      { duration: 6_000 },
    );
  }, [current, seen, t]);
  const seenAckAt = seen && current && seen.id === current.id ? seen.at : null;

  // On the server's clock: a cabinet PC's own clock may be hours off.
  const state = doctorCallState(current, now + skewMs, seenAckAt, now);

  // Back to the yellow button right when «Идёт к вам» ends, not at the
  // next 5-second tick.
  React.useEffect(() => {
    if (state !== "coming" || seenAckAt === null) return;
    const left = seenAckAt + STAFF_CALL_ACK_SHOWN_MS - Date.now();
    const id = window.setTimeout(() => setNow(Date.now()), Math.max(0, left) + 50);
    return () => window.clearTimeout(id);
  }, [state, seenAckAt]);

  const press = () =>
    call.mutate(undefined, {
      onSuccess: (r) => {
        setNow(Date.now());
        toast.info(t("sent"), { id: `staff-call:${r.call.id}` });
      },
      onError: () => toast.error(t("callFailed")),
    });

  if (state === "calling" && current) {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={press}
          disabled={call.isPending}
          title={t("callAgain")}
          className="motion-press inline-flex h-10 shrink-0 whitespace-nowrap items-center gap-2 rounded-xl border-2 border-warning bg-warning/15 px-3.5 text-sm font-semibold text-warning-text"
        >
          <BellRingIcon className="size-4 animate-pulse" />
          <span className="hidden sm:inline">{t("calling")}</span>
        </button>
        <button
          type="button"
          onClick={() => cancel.mutate(current.id)}
          disabled={cancel.isPending}
          aria-label={t("cancel")}
          title={t("cancel")}
          className="motion-press inline-flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    );
  }

  if (state === "coming" && current) {
    return (
      <button
        type="button"
        onClick={press}
        disabled={call.isPending}
        title={t("callAgain")}
        className="motion-press inline-flex h-10 shrink-0 whitespace-nowrap max-w-[18rem] items-center gap-2 rounded-xl border-2 border-success bg-success/15 px-3.5 text-sm font-semibold text-success"
      >
        <CheckCircle2Icon className="size-4 shrink-0" />
        <span className="hidden truncate sm:inline">
          {current.ackedByName ? t("coming", { name: current.ackedByName }) : t("comingNoName")}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={press}
      disabled={call.isPending}
      className={cn(
        "motion-press inline-flex h-10 shrink-0 whitespace-nowrap items-center gap-2 rounded-xl bg-warning px-3.5 text-sm font-semibold text-warning-foreground shadow-sm transition-colors hover:bg-warning/90 disabled:opacity-60",
      )}
    >
      <BellRingIcon className="size-4" />
      <span className="hidden sm:inline">{t("button")}</span>
    </button>
  );
}
