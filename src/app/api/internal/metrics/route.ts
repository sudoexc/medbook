/**
 * GET /api/internal/metrics — Prometheus scrape endpoint.
 *
 * Auth: shared bearer token in `METRICS_TOKEN` env, sent as
 * `Authorization: Bearer <token>`. Constant-time compare. When the env is
 * unset and `NODE_ENV !== "production"`, the endpoint is unauthenticated
 * (local dev). In prod, missing env returns 503 so a misconfigured deploy
 * fails loud instead of leaking the registry.
 *
 * Output: text/plain; version=0.0.4 — the Prometheus text exposition format.
 * Always 200 on auth-pass; the registry exports zero-lines for every metric
 * even before the first event, so Grafana queries don't show no-data gaps.
 */
import { timingSafeEqual } from "node:crypto";

import { renderMetrics } from "@/server/observability/metrics";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.METRICS_TOKEN;
  const auth = request.headers.get("authorization");

  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return new Response("METRICS_TOKEN not configured", { status: 503 });
    }
    // dev fallthrough — anonymous OK
  } else {
    const provided = auth?.startsWith("Bearer ")
      ? auth.slice("Bearer ".length).trim()
      : "";
    if (!provided || !tokenMatches(provided, expected)) {
      return new Response("unauthorized", { status: 401 });
    }
  }

  const body = renderMetrics();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
