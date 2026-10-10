"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { TicketPrintFrame } from "./ticket-print-frame";

/** How long to wait for the print agent to take the job before printing here. */
const PICKUP_MS = 8_000;
/** How long to wait for the printer's answer once the agent took it. */
const PRINT_MS = 12_000;
/** How long the browser fallback's frame stays after a press (the print dialog may be open). */
const FRAME_KEEP_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Printing a ticket from the desk or the iPad (owner request 09.10.2026):
 * through the clinic's print agent, straight to the network printer with
 * no dialog; when no agent runs, it does not take the job in time, or the
 * printer fails, from the browser as before (a hidden frame). A job the
 * agent did not take is cancelled first, so the slip never comes out twice.
 *
 * Returns `print(appointmentId)` and the hidden frame to render.
 */
export function useTicketPrinter() {
  const t = useTranslations("ticketPrint");
  const [frame, setFrame] = React.useState<{ id: string; n: number; token: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const viaBrowser = React.useCallback((appointmentId: string) => {
    // A fresh token per press: the stub prints a token once, however often
    // the frame reloads (owner report 10.10.2026, an old slip came out again).
    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    setFrame((p) => ({ id: appointmentId, n: (p?.n ?? 0) + 1, token }));
    // The frame is not kept once its slip is out.
    setTimeout(() => setFrame((p) => (p?.token === token ? null : p)), FRAME_KEEP_MS);
  }, []);

  const print = React.useCallback(
    async (appointmentId: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fetch("/api/crm/print-jobs", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointmentId }),
        });
        const body = res.ok ? ((await res.json()) as { queued: boolean; id?: string }) : null;
        if (!body?.queued || !body.id) {
          viaBrowser(appointmentId);
          return;
        }
        const jobId = body.id;
        const status = async () => {
          const r = await fetch(`/api/crm/print-jobs/${encodeURIComponent(jobId)}`, { credentials: "include" });
          return r.ok ? ((await r.json()) as { status: string }).status : "UNKNOWN";
        };
        let taken = false;
        const until = Date.now() + PICKUP_MS + PRINT_MS;
        while (Date.now() < until) {
          await sleep(600);
          const s = await status();
          if (s === "DONE") {
            toast.success(t("printed"));
            return;
          }
          if (s === "FAILED") {
            toast.error(t("printerFailed"));
            viaBrowser(appointmentId);
            return;
          }
          if (s === "SENT") taken = true;
          if (!taken && Date.now() > until - PRINT_MS) break;
        }
        if (taken) {
          // The agent took it and went quiet: it may well have printed.
          toast.warning(t("checkPrinter"));
          return;
        }
        const cancel = await fetch(`/api/crm/print-jobs/${encodeURIComponent(jobId)}`, {
          method: "POST",
          credentials: "include",
        });
        const cancelled = cancel.ok && ((await cancel.json()) as { cancelled: boolean }).cancelled;
        if (cancelled) viaBrowser(appointmentId);
      } catch {
        viaBrowser(appointmentId);
      } finally {
        setBusy(false);
      }
    },
    [busy, t, viaBrowser],
  );

  const element = frame ? <TicketPrintFrame appointmentId={frame.id} job={frame.n} token={frame.token} /> : null;
  return { print, busy, frame: element };
}
