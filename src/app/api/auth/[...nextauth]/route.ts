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

// Dev / CI bypass for the login throttle. Same shape as DISABLE_2FA —
// set DISABLE_AUTH_RATE_LIMIT=1 to allow the Playwright e2e suite (and
// brute-force ops bypass) to log in many users in a single minute.
function authRateLimitDisabled(): boolean {
  const v = process.env.DISABLE_AUTH_RATE_LIMIT;
  return v === "1" || v === "true";
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!authRateLimitDisabled() && !rateLimit(`auth:${clientIp(request)}`, 5, 60_000)) {
    return Response.json(
      { error: "Too many requests" },
      { status: 429, headers: { "retry-after": "60" } },
    );
  }
  return handlers.POST(request);
}
