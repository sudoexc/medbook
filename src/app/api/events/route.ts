/**
 * SSE endpoint `/api/events`.
 *
 * One stream per browser tab. The browser opens an `EventSource`, we return
 * `text/event-stream` with keep-alive, and push every event that targets
 * the subscriber's `clinicId`.
 *
 * Transport contract:
 *   - `data: <json>\n\n` per event (json is the validated envelope).
 *   - `id: <eventId>\n` line precedes the `data:` whenever the payload is a
 *     v2 envelope. `EventSource` stores it on the client side; when the
 *     connection drops and the browser reconnects it sends the value back
 *     in the `Last-Event-ID` request header so the server can replay any
 *     events the client missed during the gap.
 *   - `: ping\n\n` heartbeat every 20s. Browsers use this to detect dead
 *     sockets and reconnect.
 *   - The first line is `: ok\n\n` so proxies that buffer the first byte
 *     flush the response.
 *
 * Replay (Phase A.7):
 *   - On connect with a `Last-Event-ID` header, we look up the cursor row
 *     in `EventOutbox` and flush every `DELIVERED` row newer than the
 *     cursor (capped at `REPLAY_LIMIT`). After the replay we switch to the
 *     live in-process bus. The two pathways are deduplicated by `eventId`
 *     so a row that lands during the replay isn't re-emitted live.
 *   - If the cursor row is missing (TTL expired, manual delete) we emit
 *     a sentinel comment `: cursor-too-old\n\n` so the client can fully
 *     invalidate its cache and refetch.
 *
 * Auth:
 *   - `auth()` is required; a missing session returns 401. For SUPER_ADMIN
 *     we respect the `admin_clinic_override` cookie (HMAC-signed) so the
 *     platform operator can "impersonate" a clinic's event stream.
 *   - SYSTEM / missing clinicId → 403.
 *
 * Cleanup:
 *   - On `req.signal.abort()` (client closed) we unsubscribe from the bus
 *     and clear the heartbeat interval. No lingering handlers, no leaks.
 *
 * Scale-out:
 *   - The handler only talks to the local EventBus. When `REDIS_URL` is
 *     set, `ensureRedisSubscriber()` forwards remote events into the same
 *     bus, so this endpoint doesn't need a Redis client of its own.
 */

import { NextRequest } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";
import { isEventEnvelope } from "@/server/realtime/envelope";
import {
  ensureRedisSubscriber,
  isRedisEnabled,
} from "@/server/realtime/redis-adapter";

const REPLAY_LIMIT = 200;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// `revalidate = 0` belt-and-braces; SSE must never be cached.
export const revalidate = 0;

const HEARTBEAT_MS = 20_000;
const encoder = new TextEncoder();

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  const user = session?.user;
  if (!user) return jsonResponse({ error: "Unauthorized" }, 401);

  // `session.user.clinicId` already reflects the SUPER_ADMIN override cookie
  // thanks to the JWT callback in `src/lib/auth.ts`.
  const clinicId = user.clinicId ?? null;
  if (!clinicId) return jsonResponse({ error: "Forbidden" }, 403);

  // Start the Redis subscriber exactly once per process — idempotent no-op
  // when REDIS_URL isn't set.
  if (isRedisEnabled()) {
    try {
      ensureRedisSubscriber();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[sse] ensureRedisSubscriber failed", msg);
    }
  }

  const channel = clinicChannel(clinicId);
  const bus = getEventBus();

  // Last-Event-ID may come from the standard header (modern EventSource on
  // reconnect) or from a `?since=<eventId>` query (manual replay, used by
  // smoke tests + the mini-app prior to subscribing).
  const lastEventId =
    request.headers.get("last-event-id") ??
    request.nextUrl.searchParams.get("since") ??
    null;

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

      // Track ids that came through the replay so the live subscription
      // doesn't re-emit any row that landed during the cursor window.
      const replayedIds = new Set<string>();

      const emit = (payload: unknown) => {
        if (closed) return;
        try {
          const eventId = isEventEnvelope(payload) ? payload.eventId : null;
          if (eventId) {
            if (replayedIds.has(eventId)) return;
            replayedIds.add(eventId);
            safeEnqueue(`id: ${eventId}\ndata: ${JSON.stringify(payload)}\n\n`);
          } else {
            safeEnqueue(`data: ${JSON.stringify(payload)}\n\n`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          safeEnqueue(`: error ${msg}\n\n`);
        }
      };

      // Force an immediate flush past any intermediate buffer.
      safeEnqueue(`: ok\n\n`);

      // Replay missed events when the client carries a Last-Event-ID.
      if (lastEventId) {
        try {
          await runWithTenant({ kind: "SYSTEM" }, async () => {
            const cursor = await prisma.eventOutbox.findUnique({
              where: { id: lastEventId },
              select: { createdAt: true, clinicId: true },
            });
            if (!cursor || cursor.clinicId !== clinicId) {
              // Cursor either expired or belongs to a different tenant.
              // Client should discard caches and refetch.
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
              emit(row.envelope);
            }
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn("[sse] replay failed", msg);
          safeEnqueue(`: replay-failed\n\n`);
        }
      }

      // Forward live per-clinic events (after replay so ordering is preserved).
      const unsubscribe = bus.subscribe(channel, (payload) => emit(payload));

      const heartbeat = setInterval(() => {
        safeEnqueue(`: ping\n\n`);
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
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

      // Client closed the tab / navigated away.
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // The consumer cancelled the reader explicitly. No extra work —
      // `start`'s abort listener fires too. Guard against double-close.
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
