/**
 * Wave 2 — Public waiting-room board SSE.
 *
 *   GET /api/c/[slug]/queue/events
 *
 * Third SSE surface alongside `/api/events` (CRM, session-auth) and
 * `/api/miniapp/events` (patient, initData-auth). This one is *unauthenticated*
 * — the trust model is "physically present at the clinic", the slug is the
 * bearer (same as the rest of `/api/c/[slug]/queue/*`). Consumed by the TV
 * board and the check-in kiosk to replace 3s polling.
 *
 * Safety:
 *   Everything on the clinic bus passes through `isBoardEvent` (whitelist) +
 *   `projectBoardEvent` (PHI-safe scalar projection) before it reaches the
 *   wire — see `board-stream.ts`. A patient name can never leak onto a screen
 *   the whole waiting room sees.
 *
 * No replay:
 *   Unlike the CRM/mini-app streams there's no `Last-Event-ID` catch-up. A TV
 *   that reconnects just refetches `/api/c/[slug]/queue/board`; replaying a
 *   stale `queue.called` would re-chime an old call. The events are ephemeral
 *   "something changed" pokes, not a durable log.
 */
import type { NextRequest } from "next/server";

import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";
import {
  ensureRedisSubscriber,
  isRedisEnabled,
} from "@/server/realtime/redis-adapter";
import { resolvePublicClinic } from "@/server/clinic-public/resolve";
import { isBoardEvent, projectBoardEvent } from "@/server/realtime/board-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEARTBEAT_MS = 20_000;
const encoder = new TextEncoder();

export async function GET(request: NextRequest): Promise<Response> {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { clinicId } = resolved.ctx;

  // Start the Redis subscriber once — idempotent no-op when REDIS_URL is unset.
  if (isRedisEnabled()) {
    try {
      ensureRedisSubscriber();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[board/sse] ensureRedisSubscriber failed", msg);
    }
  }

  const channel = clinicChannel(clinicId);
  const bus = getEventBus();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const emit = (raw: unknown) => {
        if (closed) return;
        if (!isBoardEvent(raw)) return;
        const projected = projectBoardEvent(raw);
        if (!projected) return;
        safeEnqueue(`data: ${JSON.stringify(projected)}\n\n`);
      };

      // Force an immediate flush past any intermediate proxy buffer.
      safeEnqueue(`: ok\n\n`);

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

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // `start`'s abort listener handles cleanup; guarded against double-close.
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
