/**
 * NextAuth catch-all route.
 *
 * Per TZ §9.2 we throttle `/api/auth/*` to 5 req/min/IP to slow credential
 * stuffing and brute-force attempts on the credentials provider. GET is left
 * unthrottled because the sign-in flow legitimately pulls `providers`,
 * `session`, and `csrf` endpoints during every render.
 *
 * The in-memory `rateLimit()` helper is not cluster-safe — tracked as M3 in
 * `docs/security/phase-7.md`. Phase 6 will swap the backing store for Redis.
 */
import type { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const { GET } = handlers;

function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!rateLimit(`auth:${clientIp(request)}`, 5, 60_000)) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  return handlers.POST(request);
}
