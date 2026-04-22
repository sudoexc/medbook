/**
 * LogOnlyTelephonyAdapter — default telephony implementation.
 *
 * No real SIP / PSTN integration. All it does is:
 *   - `call()`  — persist a `Call` row with a fake `sipCallId = log-<uuid>`
 *                 and immediately republish a synthetic `ringing` event on
 *                 `telephony.ringing` so downstream consumers (the webhook
 *                 path, the reception widget) behave exactly as they would
 *                 for a real call.
 *   - `hangup()` — look up the Call by `sipCallId`, set `endedAt = now()`,
 *                  compute `durationSec`, publish `telephony.hangup` then
 *                  `call.ended` for UI consumers.
 *   - `onEvent()` — subscribe to the shared event bus on all
 *                   `telephony.*` channels.
 *
 * The adapter is **tenant-aware**: `call()` reads the caller's
 * `TenantContext` so the Call row is scoped correctly. The webhook handler
 * opens its own `runWithTenant` to write inbound rings. The UI always
 * operates through `createApiHandler`, so tenant context is automatic for
 * outbound operator-initiated calls.
 */

import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { requireTenant } from "@/lib/tenant-context";
import { getEventBus, publish } from "@/server/realtime/event-bus";

import {
  CALL_CHANNELS,
  TELEPHONY_CHANNELS,
  type TelephonyAdapter,
  type TelephonyEvent,
} from "./adapter";

function makeSipCallId(): string {
  return `log-${randomUUID()}`;
}

export class LogOnlyTelephonyAdapter implements TelephonyAdapter {
  readonly name = "log-only";

  /**
   * Operator-initiated outbound call. Creates a Call row with
   * direction=OUT and immediately fires a synthetic `ringing` event so
   * the UI sees it as an active leg.
   */
  async call(to: string, from: string): Promise<{ callId: string }> {
    const ctx = requireTenant();
    if (ctx.kind === "SUPER_ADMIN" || ctx.kind === "SYSTEM") {
      // Outbound calls always originate from a clinic operator.
      throw new Error("LogOnly.call requires TENANT context");
    }
    const sipCallId = makeSipCallId();
    // `clinicId` is injected by the Prisma tenant extension — see
    // `src/lib/prisma.ts`. Cast away the required-clinicId typing to match
    // the existing pattern in `src/app/api/crm/calls/route.ts`.
    const created = await prisma.call.create({
      data: {
        direction: "OUT",
        fromNumber: from,
        toNumber: to,
        operatorId: ctx.userId,
        sipCallId,
      } as never,
    });

    // Synthetic `ringing` so reception/call-center widgets can reflect it.
    const evt: TelephonyEvent = {
      kind: "ringing",
      callId: sipCallId,
      from,
      to,
      timestamp: created.createdAt,
      meta: { adapter: this.name, direction: "OUT", dbId: created.id },
    };
    publish(TELEPHONY_CHANNELS.ringing, evt);
    publish(CALL_CHANNELS.incoming, {
      callId: sipCallId,
      clinicId: ctx.clinicId,
      direction: "OUT",
      from,
      to,
      dbId: created.id,
    });

    return { callId: sipCallId };
  }

  /**
   * Close the leg. Idempotent: a second hangup is a no-op.
   */
  async hangup(callId: string): Promise<void> {
    const ctx = requireTenant();
    if (ctx.kind !== "TENANT") {
      throw new Error("LogOnly.hangup requires TENANT context");
    }
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId: ctx.clinicId, sipCallId: callId } },
    });
    if (!existing) return;
    if (existing.endedAt) {
      // Already closed.
      return;
    }
    const endedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.round((endedAt.getTime() - existing.createdAt.getTime()) / 1000),
    );
    const updated = await prisma.call.update({
      where: { id: existing.id },
      data: { endedAt, durationSec },
    });

    const evt: TelephonyEvent = {
      kind: "hangup",
      callId,
      from: updated.fromNumber,
      to: updated.toNumber,
      timestamp: endedAt,
      meta: { adapter: this.name, dbId: updated.id, durationSec },
    };
    publish(TELEPHONY_CHANNELS.hangup, evt);
    publish(CALL_CHANNELS.ended, {
      callId,
      clinicId: ctx.clinicId,
      dbId: updated.id,
      durationSec,
    });
  }

  /**
   * Subscribe to all `telephony.*` lifecycle events. The returned function
   * unsubscribes all four channels in one call.
   */
  onEvent(cb: (e: TelephonyEvent) => void): () => void {
    const bus = getEventBus();
    const unsubs: Array<() => void> = [];
    for (const channel of Object.values(TELEPHONY_CHANNELS)) {
      unsubs.push(
        bus.subscribe(channel, (payload) => {
          // Defensive: only forward events that match our TelephonyEvent shape.
          if (isTelephonyEvent(payload)) cb(payload);
        }),
      );
    }
    return () => {
      for (const u of unsubs) u();
    };
  }
}

function isTelephonyEvent(x: unknown): x is TelephonyEvent {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.kind === "string" &&
    typeof o.callId === "string" &&
    typeof o.from === "string" &&
    typeof o.to === "string" &&
    o.timestamp instanceof Date
  );
}

/** Exported for tests that want a pristine adapter. */
export function createLogOnlyTelephonyAdapter(): TelephonyAdapter {
  return new LogOnlyTelephonyAdapter();
}
