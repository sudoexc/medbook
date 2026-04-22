/**
 * SSE endpoint `/api/events`.
 *
 * One stream per browser tab. The browser opens an `EventSource`, we return
 * `text/event-stream` with keep-alive, and push every `AppEvent` that
 * targets the subscriber's `clinicId`.
 *
 * Transport contract:
 *   - `data: <json>\n\n` per event (json is the validated envelope).
 *   - `: ping\n\n` heartbeat every 20s. Browsers use this to detect dead
 *     sockets and reconnect.
 *   - The first line is `: ok\n\n` so proxies that buffer the first byte
 *     flush the response.
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
import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";
import {
  ensureRedisSubscriber,
  isRedisEnabled,
} from "@/server/realtime/redis-adapter";

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

      // Force an immediate flush past any intermediate buffer.
      safeEnqueue(`: ok\n\n`);

      // Forward per-clinic events.
      const unsubscribe = bus.subscribe(channel, (payload) => {
        if (closed) return;
        try {
          const json = JSON.stringify(payload);
          safeEnqueue(`data: ${json}\n\n`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          safeEnqueue(`: error ${msg}\n\n`);
        }
      });

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
