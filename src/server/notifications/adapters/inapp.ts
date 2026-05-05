/**
 * INAPP adapter — no-op "send".
 *
 * INAPP messages are surfaced inside the Mini App (`/c/[slug]/my`) and the
 * CRM patient portal as a banner/inbox. There's nothing to push externally:
 * the NotificationSend row IS the message. Once it lands in the DB with
 * `status=DELIVERED` and `readAt=null` it's visible to the patient on
 * their next session.
 *
 * The adapter is invoked from `notifications-send.ts` to keep the same
 * delivery contract (status transitions, externalId, retryCount) as the
 * SMS/TG adapters. It immediately stamps `deliveredAt` because there's no
 * network round-trip — delivery is local DB write.
 *
 * Idempotency: if the worker re-runs with the same `sendId`, the row will
 * already be SENT/DELIVERED and the worker short-circuits before calling
 * us. So we don't need internal dedupe.
 */
export type InAppSendResult = {
  /** Stable string used as `externalId`. Mirrors TG/SMS shape. */
  inboxId: string;
};

export interface InAppAdapter {
  readonly name: "log-only" | "inapp" | string;
  send(sendId: string, body: string): Promise<InAppSendResult>;
}

export class LocalInAppAdapter implements InAppAdapter {
  readonly name = "inapp";

  async send(sendId: string, body: string): Promise<InAppSendResult> {
    console.info(
      `[inapp] sendId=${sendId} body=${body.slice(0, 80)}${body.length > 80 ? "..." : ""}`,
    );
    return { inboxId: `inapp:${sendId}` };
  }
}
