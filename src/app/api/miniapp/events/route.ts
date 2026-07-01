/**
 * Phase M3 — Patient-scoped SSE for the Telegram Mini App.
 *
 *   GET /api/miniapp/events?clinicSlug=…
 *
 * Mirrors `/api/events` (CRM SSE) but with a patient-scoped allowlist
 * instead of a clinic-only scope. Per TZ §4.4 — every envelope landing on
 * the clinic bus is filtered through `{ clinicId, patientIds }` before
 * reaching the client.
 *
 * Allowed patient set is built once per connect:
 *   • the TG-authenticated owner (`ctx.patientId`)
 *   • every relative the owner linked via `PatientFamily`
 *
 * An envelope is delivered when:
 *   1. `tenantScope.clinicId` matches the connect's clinic, AND
 *   2. either `tenantScope.patientId` is in the allow-set, OR
 *      `payload.patientId` is in the allow-set
 *
 * Anything else is dropped silently. The clinic-only events (e.g. doctor
 * schedule edits with no patientId) intentionally never reach the mini-app.
 *
 * Replay:
 *   On connect with `Last-Event-ID` (header) or `?since=<eventId>` (query),
 *   we look up the cursor row in `EventOutbox` and flush every newer
 *   `DELIVERED` row that survives the same filter. Capped at REPLAY_LIMIT.
 *   When the cursor row is missing / belongs to another clinic, we emit
 *   `: cursor-too-old\n\n` so the client wipes its TanStack cache and
 *   refetches.
 *
 * Auth:
 *   Reuses `resolveMiniAppContext` (init-data verify + patient resolution).
 *   PatientNotRegistered (428) and the other miniapp auth failures are
 *   re-surfaced as the same JSON shape the rest of the miniapp returns —
 *   the EventSource consumer treats those as "open failed" and stays
 *   silent.
 *
 * Cleanup:
 *   On `request.signal.abort()` we unsubscribe + clear the heartbeat. No
 *   leaks even on a thundering-herd disconnect.
 */
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";
import {
  isEventEnvelope,
  type EventEnvelope,
} from "@/server/realtime/envelope";
import type { EventType } from "@/server/realtime/events";
import {
  ensureRedisSubscriber,
  isRedisEnabled,
} from "@/server/realtime/redis-adapter";
import { resolveMiniAppContext } from "@/server/miniapp/handler";
import { getFamilyAllowedPatientIds } from "@/server/miniapp/active-patient";
import { getMetrics } from "@/server/observability/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const REPLAY_LIMIT = 200;
const HEARTBEAT_MS = 20_000;
const encoder = new TextEncoder();

type AllowedScope = {
  clinicId: string;
  patientIds: Set<string>;
};

/**
 * Decide whether an envelope is for this connected patient. Pure function —
 * unit-tested by `tests/unit/miniapp-sse-filter.test.ts`.
 */
export function shouldDeliverToMiniApp(
  envelope: EventEnvelope,
  allowed: AllowedScope,
): boolean {
  if (envelope.tenantScope.clinicId !== allowed.clinicId) return false;
  if (
    envelope.tenantScope.patientId &&
    allowed.patientIds.has(envelope.tenantScope.patientId)
  ) {
    return true;
  }
  // The clinic-only events (cabinet schedule, staff-only audit) never carry
  // a patient hint — they shouldn't leak into the mini-app stream.
  const payload = envelope.payload;
  if (payload && typeof payload === "object" && "patientId" in payload) {
    const pid = (payload as { patientId?: unknown }).patientId;
    if (typeof pid === "string" && allowed.patientIds.has(pid)) return true;
  }
  return false;
}

/**
 * Patient-facing event types eligible for delivery over the legacy v1 path
 * (see `shouldDeliverV1ToMiniApp`). Must stay a subset of the client's
 * `MINIAPP_INVALIDATION_MAP` keys — `tests/unit/miniapp-sse-filter.test.ts`
 * asserts this so a v1 event the client can't act on is never streamed.
 *
 * The gate exists because some v1 payloads carry a `patientId` for a *staff*
 * concern (e.g. `call.incoming`), which must NOT leak to the patient even
 * though the id matches. Only types a patient legitimately owns are listed.
 */
export const MINIAPP_DELIVERABLE_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  "appointment.created",
  "appointment.updated",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
  "queue.updated",
  "notification.sent",
  "notification.read",
  "patient.profileUpdated",
  "patient.familyLinked",
  "patient.familyUnlinked",
  "nps.submitted",
  "previsit.submitted",
  "payment.paid",
  "eprescription.issued",
  "eprescription.cancelled",
  "prescription.created",
  "prescription.updated",
  "visit-note.finalized",
  "lab.result.reviewed",
  "referral.created",
  "document.created",
  "doctor.scheduleChanged",
  "tg.message.new",
  "tg.conversation.updated",
]);

/**
 * Delivery decision for a legacy v1 `AppEvent` ({ type, clinicId, at, payload })
 * published via `publishEventSafe` (no `tenantScope`, no `eventId`). These ride
 * the same clinic bus as v2 envelopes; the CRM stream already forwards both, so
 * the mini-app does too — gated hard so a patient only ever sees their own data:
 *
 *   1. `type` is patient-facing (`MINIAPP_DELIVERABLE_TYPES`), AND
 *   2. `clinicId` matches the connection's clinic, AND
 *   3. `payload.patientId` is a string in the allow-set (owner + family).
 *
 * v1 events carry no `eventId`, so they are live-only (not replayable) — the
 * 60s query poll + v2 replay cover a reconnect gap. Pure + unit-tested.
 */
export function shouldDeliverV1ToMiniApp(
  event: unknown,
  allowed: AllowedScope,
): boolean {
  if (!event || typeof event !== "object") return false;
  const e = event as { type?: unknown; clinicId?: unknown; payload?: unknown };
  if (typeof e.type !== "string") return false;
  if (!MINIAPP_DELIVERABLE_TYPES.has(e.type as EventType)) return false;
  if (e.clinicId !== allowed.clinicId) return false;
  const payload = e.payload;
  if (!payload || typeof payload !== "object") return false;
  const pid = (payload as { patientId?: unknown }).patientId;
  return typeof pid === "string" && allowed.patientIds.has(pid);
}

export async function GET(request: NextRequest): Promise<Response> {
  // Re-use the miniapp auth helper. The streaming Response runs *outside*
  // any tenant scope — we only need the resolved clinicId + patientId, and
  // we wrap the DB-touching replay step in SYSTEM context ourselves.
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { clinicId, patientId } = resolved.ctx;

  const allowedIds = await runWithTenant({ kind: "SYSTEM" }, () =>
    getFamilyAllowedPatientIds(clinicId, patientId),
  );
  const allowed: AllowedScope = {
    clinicId,
    patientIds: new Set(allowedIds),
  };

  // Start the Redis subscriber once — idempotent no-op when REDIS_URL is
  // unset.
  if (isRedisEnabled()) {
    try {
      ensureRedisSubscriber();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[miniapp/sse] ensureRedisSubscriber failed", msg);
    }
  }

  const channel = clinicChannel(clinicId);
  const bus = getEventBus();

  const lastEventId =
    request.headers.get("last-event-id") ??
    request.nextUrl.searchParams.get("since") ??
    null;

  const metrics = getMetrics();
  metrics.sseConnectionsActive.inc({ clinic_id: clinicId });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const replayedIds = new Set<string>();

      const emit = (payload: unknown, kind: "live" | "replay") => {
        if (closed) return;
        if (isEventEnvelope(payload)) {
          // v2 outbox envelope — patient-scoped + replayable (carries eventId).
          if (!shouldDeliverToMiniApp(payload, allowed)) return;
          const { eventId } = payload;
          if (replayedIds.has(eventId)) return;
          replayedIds.add(eventId);
          try {
            safeEnqueue(`id: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`);
            metrics.sseEventsDelivered.inc({
              event_type: payload.type,
              clinic_id: clinicId,
            });
            if (kind === "replay") {
              metrics.sseReplayEvents.inc({ clinic_id: clinicId });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            safeEnqueue(`: error ${msg}\n\n`);
          }
          return;
        }
        // Legacy v1 AppEvent (publishEventSafe): no envelope, no eventId → not
        // replayable, so it only rides the live bus. Deliver the patient-safe
        // subset whose payload names an allowed patient, so v1 publishers
        // (walk-in, chat, queue transitions, TG webhook) reach the mini-app —
        // the same both-shapes handling the CRM `/api/events` stream already does.
        if (kind !== "live") return;
        if (!shouldDeliverV1ToMiniApp(payload, allowed)) return;
        try {
          safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`);
          metrics.sseEventsDelivered.inc({
            event_type: (payload as { type: string }).type,
            clinic_id: clinicId,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          safeEnqueue(`: error ${msg}\n\n`);
        }
      };

      safeEnqueue(`: ok\n\n`);

      if (lastEventId) {
        try {
          await runWithTenant({ kind: "SYSTEM" }, async () => {
            const cursor = await prisma.eventOutbox.findUnique({
              where: { id: lastEventId },
              select: { createdAt: true, clinicId: true },
            });
            if (!cursor || cursor.clinicId !== clinicId) {
              safeEnqueue(`: cursor-too-old\n\n`);
              return;
            }
            const missed = await prisma.eventOutbox.findMany({
              where: {
                clinicId,
                status: "DELIVERED",
                createdAt: { gt: cursor.createdAt },
              },
              orderBy: { createdAt: "asc" },
              take: REPLAY_LIMIT,
              select: { envelope: true },
            });
            for (const row of missed) {
              emit(row.envelope, "replay");
            }
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[miniapp/sse] replay failed", msg);
          safeEnqueue(`: replay-failed\n\n`);
        }
      }

      const unsubscribe = bus.subscribe(channel, (payload) =>
        emit(payload, "live"),
      );

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        metrics.sseConnectionsActive.dec({ clinic_id: clinicId });
        try {
          unsubscribe();
        } catch {
          /* ignore */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // Mirror the CRM SSE: `start`'s abort listener handles the heavy
      // cleanup. The guard against double-close lives inside `cleanup`.
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
