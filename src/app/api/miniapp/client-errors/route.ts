/**
 * Phase M4 — POST /api/miniapp/client-errors.
 *
 * Sink for the mini-app `MiniAppErrorBoundary` reports + ad-hoc client-side
 * `reportClientError(err)` calls. Best-effort logging only: we never throw
 * back at the client (a failed report must not cause a second error to
 * shadow the first). Payloads are size-bounded; anything over 64 KiB is
 * truncated server-side so a runaway stack trace can't OOM the API process.
 *
 * Auth is opportunistic — we attempt `resolveMiniAppContext` to enrich the
 * log with `{ clinicId, patientId }`, but a missing/invalid init-data still
 * succeeds with `null` ids. The report is dumped via `console.error` so it
 * lands in the structured stdout collector (datadog / logflare in prod).
 *
 * No persistence yet — Phase M7 wires a `MiniAppClientError` Prisma model
 * once we have a dashboard to look at. Today the log line is what oncall
 * looks at.
 */
import { z } from "zod";

import { resolveMiniAppContext } from "@/server/miniapp/handler";
import { getMetrics } from "@/server/observability/metrics";

const Body = z
  .object({
    message: z.string().min(1).max(2000),
    stack: z.string().max(16_000).nullable().optional(),
    componentStack: z.string().max(16_000).nullable().optional(),
    location: z.string().max(2000).nullable().optional(),
    userAgent: z.string().max(500).nullable().optional(),
    clinicSlug: z.string().max(64).nullable().optional(),
    at: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();

const MAX_BYTES = 64 * 1024;

function clip(input: string | null | undefined, max: number): string | null {
  if (!input) return null;
  return input.length > max ? `${input.slice(0, max)}…` : input;
}

export async function POST(request: Request): Promise<Response> {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_BYTES) {
    return Response.json({ ok: false, reason: "payload_too_large" }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const result = Body.safeParse(parsed);
  if (!result.success) {
    return Response.json(
      { ok: false, reason: "bad_payload", issues: result.error.issues },
      { status: 400 },
    );
  }
  const data = result.data;

  // Opportunistic auth — the report is useful even without identity.
  let clinicId: string | null = null;
  let patientId: string | null = null;
  try {
    const resolved = await resolveMiniAppContext(request);
    if (resolved.ok) {
      clinicId = resolved.ctx.clinicId;
      patientId = resolved.ctx.patientId;
    }
  } catch {
    /* ignore — report still logs */
  }

  // eslint-disable-next-line no-console
  console.error("[miniapp/client-error]", {
    clinicId,
    patientId,
    clinicSlug: data.clinicSlug ?? null,
    message: clip(data.message, 1000),
    location: clip(data.location ?? null, 500),
    stack: clip(data.stack ?? null, 4000),
    componentStack: clip(data.componentStack ?? null, 4000),
    userAgent: clip(data.userAgent ?? null, 300),
    at: data.at ?? new Date().toISOString(),
  });

  getMetrics().clientErrors.inc({ clinic_id: clinicId ?? "unknown" });

  return Response.json({ ok: true });
}
