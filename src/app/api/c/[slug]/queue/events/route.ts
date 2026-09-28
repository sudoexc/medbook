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
 * Limits (audit INF-10):
 *   One address may hold at most MAX_STREAMS_PER_ADDRESS open streams and
 *   open at most OPENS_PER_MINUTE of them per minute. A doctor's own TV
 *   passes its `Doctor.tvToken` as `?screen=` and is exempt: a clinic is one
 *   NAT address, and patients following `/q` on the clinic Wi-Fi must never
 *   push the TV in the doctor's room off its live call signal. A refused
 *   stream is not fatal to anyone: every consumer also polls.
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
import { acquireConnection } from "@/server/realtime/connection-cap";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ipBucket, realClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEARTBEAT_MS = 20_000;
const encoder = new TextEncoder();

/** Anonymous streams one address may hold open at once. */
export const MAX_STREAMS_PER_ADDRESS = 10;
/** Anonymous stream opens per address per minute (reconnect storms). */
const OPENS_PER_MINUTE = 60;

function tooMany(reason: string): Response {
  return Response.json(
    { error: "TooManyRequests", reason },
    { status: 429, headers: { "Retry-After": "60" } },
  );
}

/** Is `?screen=` the TV token of an active doctor of this clinic? */
async function isClinicScreen(
  request: NextRequest,
  clinicId: string,
): Promise<boolean> {
  const token = request.nextUrl.searchParams.get("screen");
  if (!token) return false;
  const doctor = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctor.findFirst({
      where: { tvToken: token, clinicId, isActive: true },
      select: { id: true },
    }),
  );
  return doctor !== null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const resolved = await resolvePublicClinic(request);
  if (!resolved.ok) return resolved.response;
  const { clinicId } = resolved.ctx;

  let release: (() => void) | null = null;
  if (!(await isClinicScreen(request, clinicId))) {
    const address = ipBucket(realClientIp(request));
    if (!rateLimit(`board-sse:${address}`, OPENS_PER_MINUTE, 60_000, "board-sse-open")) {
      return tooMany("rate_limited");
    }
    release = acquireConnection("board-sse", address, MAX_STREAMS_PER_ADDRESS);
    if (!release) return tooMany("too_many_streams");
  }

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

  let stopStream: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client is gone. Tear everything down now: flipping a flag
          // alone left the subscription, the heartbeat and the address's
          // connection slot held until an abort that may never come.
          stopStream?.();
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
        // The connection slot goes back whichever path ends the stream.
        release?.();
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

      stopStream = cleanup;
      if (request.signal.aborted) cleanup();
      else request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      // Usually the abort listener got here first; cleanup is idempotent.
      stopStream?.();
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
