"use client";

import * as React from "react";
import { CheckCircle2, Phone } from "lucide-react";

import { useT } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { MButton, MHint } from "./mini-ui";
import type { ShareContact } from "../_hooks/use-share-contact";

/**
 * The patient's number, read-only (audit PH-01).
 *
 * A typed number used to be written straight into the card, and walk-in /
 * CRM lookups trusted it: anyone could claim a stranger's number and later
 * receive her visits. The number is now shown as the clinic has it, and the
 * only way to set or confirm it is Telegram's own contact sharing. The
 * screen owns the `useShareContact()` state, so the booking confirm screen
 * can wait for the step (audit MA-04).
 */
export function PhoneConfirm({ share }: { share: ShareContact }) {
  const t = useT();
  const { state } = useMiniAppAuth();
  const { status, start } = share;
  const patient = state.status === "ready" ? state.patient : null;
  const verified = !!patient?.phoneVerified;
  const phone = patient?.hasPhone ? patient.phone : "";

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
        {t.phoneConfirm.label}
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Phone className="h-4 w-4 shrink-0" style={{ color: "var(--tg-hint)" }} aria-hidden />
        <span className="font-medium">{phone || t.phoneConfirm.notVerified}</span>
        {verified ? (
          <span
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: "var(--ma-success)" }}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {t.phoneConfirm.verified}
          </span>
        ) : null}
      </div>
      {verified ? null : (
        <>
          <MHint>{t.phoneConfirm.hint}</MHint>
          <MButton
            type="button"
            variant="secondary"
            block
            disabled={status === "asking" || status === "waiting"}
            onClick={start}
          >
            {status === "waiting" ? t.phoneConfirm.waiting : t.phoneConfirm.button}
          </MButton>
          {status === "failed" ? <MHint>{t.phoneConfirm.failed}</MHint> : null}
          {status === "unsupported" ? (
            <MHint>{t.phoneConfirm.unsupported}</MHint>
          ) : null}
        </>
      )}
      {status === "done" && verified ? <MHint>{t.phoneConfirm.done}</MHint> : null}
    </div>
  );
}
