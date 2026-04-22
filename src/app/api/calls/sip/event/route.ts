/**
 * SIP provider webhook.
 *
 * POST /api/calls/sip/event
 *
 * Generic payload contract, normalized from real providers by adapter code.
 * The schema is intentionally loose — every provider (OnlinePBX / Mango /
 * Asterisk ARI / UIS) has a different shape, and we expect the adapter layer
 * to map it to this canonical JSON before hitting this endpoint.
 *
 * Security model (§6.7.5):
 *   - Webhook secret verified against the clinic's `ProviderConnection.config.webhookSecret`.
 *   - When no secret is configured, dev mode accepts the request but logs a loud
 *     warning so the omission shows up in logs.
 *   - GET (and any non-POST) → 405.
 *
 * Tenant model: the webhook cannot use NextAuth. We receive `clinicSlug` via
 * query string (or `x-clinic-slug` header) and run under `runWithTenant(SYSTEM)`
 * with explicit `clinicId` in every Prisma call.
 *
 * Event semantics vs the `Call` model:
 *   - ringing  → upsert Call(direction=IN, no endedAt)
 *   - answered → no schema column yet (duration will be computed at hangup).
 *                We record a tag `answered` and nothing else.
 *   - hangup   → set endedAt, durationSec (endedAt - createdAt).
 *   - missed   → set direction=MISSED + endedAt (no duration).
 *
 * TODO(prisma-schema-owner): add `status` + `startedAt` + `answeredAt` columns
 * so we don't have to collapse state into (direction, endedAt).
 *
 * TODO(admin-platform-builder): expose `ProviderConnection` settings UI so the
 * webhook secret can be rotated without a DB edit.
 */

import type { NextRequest } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneSearchVariants } from "@/lib/phone";
import { runWithTenant } from "@/lib/tenant-context";
import { CALL_CHANNELS, TELEPHONY_CHANNELS } from "@/server/telephony/adapter";
import { publish } from "@/server/realtime/event-bus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EventKind = z.enum(["ringing", "answered", "hangup", "missed"]);

const EventSchema = z.object({
  kind: EventKind,
  callId: z.string().min(1).max(200),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
  timestamp: z.coerce.date(),
  operatorId: z.string().optional().nullable(),
  recordingUrl: z.string().url().optional().nullable(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type SipEvent = z.infer<typeof EventSchema>;

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: "Method Not Allowed" }, 405);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PATCH = methodNotAllowed;

async function resolveClinic(
  request: NextRequest,
): Promise<{
  id: string;
  slug: string;
  webhookSecret: string | null;
} | null> {
  const url = new URL(request.url);
  const slug =
    url.searchParams.get("clinicSlug") ??
    request.headers.get("x-clinic-slug") ??
    "";
  if (!slug) return null;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const clinic = await prisma.clinic.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    });
    if (!clinic) return null;
    // See `index.ts` TODO — SIP provider lives under kind: OTHER, label: "sip"
    // until the enum is extended. Webhook secret kept in `config.webhookSecret`.
    const conn = await prisma.providerConnection.findFirst({
      where: { clinicId: clinic.id, active: true, kind: "OTHER", label: "sip" },
      select: { config: true },
    });
    let webhookSecret: string | null = null;
    if (conn?.config && typeof conn.config === "object" && !Array.isArray(conn.config)) {
      const cfg = conn.config as Record<string, unknown>;
      const raw = cfg.webhookSecret;
      if (typeof raw === "string" && raw.length > 0) webhookSecret = raw;
    }
    return { id: clinic.id, slug: clinic.slug, webhookSecret };
  });
}

async function linkPatientByPhone(
  clinicId: string,
  phone: string,
): Promise<string | null> {
  const variants = phoneSearchVariants(phone);
  if (variants.length === 0) {
    const n = normalizePhone(phone);
    if (!n) return null;
    variants.push(n);
  }
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const match = await prisma.patient.findFirst({
      where: {
        clinicId,
        OR: [
          { phoneNormalized: { in: variants } },
          { phone: { in: variants } },
        ],
      },
      select: { id: true },
    });
    return match?.id ?? null;
  });
}

async function handleRinging(
  clinicId: string,
  evt: SipEvent,
): Promise<{ dbId: string; patientId: string | null }> {
  const patientId = await linkPatientByPhone(clinicId, evt.from);
  const createdAt = evt.timestamp;

  const row = await runWithTenant({ kind: "SYSTEM" }, async () =>
    prisma.call.upsert({
      where: { clinicId_sipCallId: { clinicId, sipCallId: evt.callId } },
      create: {
        clinicId,
        direction: "IN",
        fromNumber: evt.from,
        toNumber: evt.to,
        sipCallId: evt.callId,
        patientId,
        operatorId: evt.operatorId ?? null,
        createdAt,
        recordingUrl: evt.recordingUrl ?? null,
      },
      update: {
        // Re-ringing: don't clobber patientId if we already linked it.
        patientId: patientId ?? undefined,
        recordingUrl: evt.recordingUrl ?? undefined,
      },
      select: { id: true, patientId: true },
    }),
  );
  return { dbId: row.id, patientId: row.patientId };
}

async function handleAnswered(clinicId: string, evt: SipEvent): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId, sipCallId: evt.callId } },
      select: { id: true, tags: true, operatorId: true },
    });
    if (!existing) {
      // Out-of-order event: create a minimal IN row so hangup has something
      // to update. Direction defaults to IN (operator answered something).
      await prisma.call.create({
        data: {
          clinicId,
          direction: "IN",
          fromNumber: evt.from,
          toNumber: evt.to,
          sipCallId: evt.callId,
          operatorId: evt.operatorId ?? null,
          tags: ["answered"],
        },
      });
      return;
    }
    const nextTags = existing.tags.includes("answered")
      ? existing.tags
      : [...existing.tags, "answered"];
    await prisma.call.update({
      where: { id: existing.id },
      data: {
        tags: nextTags,
        operatorId: evt.operatorId ?? existing.operatorId ?? undefined,
      },
    });
  });
}

async function handleHangup(clinicId: string, evt: SipEvent): Promise<{ dbId: string } | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId, sipCallId: evt.callId } },
      select: { id: true, createdAt: true, endedAt: true },
    });
    if (!existing) return null;
    if (existing.endedAt) return { dbId: existing.id };
    const endedAt = evt.timestamp;
    const durationSec = Math.max(
      0,
      Math.round((endedAt.getTime() - existing.createdAt.getTime()) / 1000),
    );
    const updated = await prisma.call.update({
      where: { id: existing.id },
      data: {
        endedAt,
        durationSec,
        recordingUrl: evt.recordingUrl ?? undefined,
      },
      select: { id: true },
    });
    return { dbId: updated.id };
  });
}

async function handleMissed(clinicId: string, evt: SipEvent): Promise<{ dbId: string } | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId, sipCallId: evt.callId } },
      select: { id: true },
    });
    if (existing) {
      const updated = await prisma.call.update({
        where: { id: existing.id },
        data: {
          direction: "MISSED",
          endedAt: evt.timestamp,
        },
        select: { id: true },
      });
      return { dbId: updated.id };
    }
    // No prior ringing event — create a MISSED row.
    const patientId = await linkPatientByPhone(clinicId, evt.from);
    const created = await prisma.call.create({
      data: {
        clinicId,
        direction: "MISSED",
        fromNumber: evt.from,
        toNumber: evt.to,
        sipCallId: evt.callId,
        endedAt: evt.timestamp,
        patientId,
      },
      select: { id: true },
    });
    return { dbId: created.id };
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const clinic = await resolveClinic(request);
  if (!clinic) return jsonResponse({ error: "Clinic not found" }, 404);

  // Secret verification. Header `x-sip-secret` is canonical; some providers
  // send it in the query string, which we also accept.
  const providedSecret =
    request.headers.get("x-sip-secret") ??
    new URL(request.url).searchParams.get("secret") ??
    "";
  if (clinic.webhookSecret) {
    if (!safeEqual(providedSecret, clinic.webhookSecret)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    // Production clinics must have a secret configured.
    return jsonResponse({ error: "Webhook secret not configured" }, 401);
  } else {
    console.warn(
      `[sip:webhook clinic=${clinic.slug}] no webhookSecret configured — accepting in dev mode`,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ error: "InvalidJson" }, 400);
  }
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonResponse(
      { error: "ValidationError", issues: parsed.error.issues },
      400,
    );
  }
  const evt = parsed.data;

  try {
    switch (evt.kind) {
      case "ringing": {
        const { dbId, patientId } = await handleRinging(clinic.id, evt);
        publish(TELEPHONY_CHANNELS.ringing, {
          kind: "ringing",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: { dbId, patientId, clinicId: clinic.id, ...(evt.meta ?? {}) },
        });
        publish(CALL_CHANNELS.incoming, {
          callId: evt.callId,
          clinicId: clinic.id,
          direction: "IN",
          from: evt.from,
          to: evt.to,
          patientId,
          dbId,
        });
        break;
      }
      case "answered": {
        await handleAnswered(clinic.id, evt);
        publish(TELEPHONY_CHANNELS.answered, {
          kind: "answered",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: { clinicId: clinic.id, ...(evt.meta ?? {}) },
        });
        publish(CALL_CHANNELS.answered, {
          callId: evt.callId,
          clinicId: clinic.id,
          operatorId: evt.operatorId ?? null,
        });
        break;
      }
      case "hangup": {
        const res = await handleHangup(clinic.id, evt);
        publish(TELEPHONY_CHANNELS.hangup, {
          kind: "hangup",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: { clinicId: clinic.id, dbId: res?.dbId, ...(evt.meta ?? {}) },
        });
        publish(CALL_CHANNELS.ended, {
          callId: evt.callId,
          clinicId: clinic.id,
          dbId: res?.dbId ?? null,
        });
        break;
      }
      case "missed": {
        const res = await handleMissed(clinic.id, evt);
        publish(TELEPHONY_CHANNELS.missed, {
          kind: "missed",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: { clinicId: clinic.id, dbId: res?.dbId, ...(evt.meta ?? {}) },
        });
        publish(CALL_CHANNELS.ended, {
          callId: evt.callId,
          clinicId: clinic.id,
          dbId: res?.dbId ?? null,
          missed: true,
        });
        break;
      }
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[sip:webhook clinic=${clinic.slug}] error: ${message}`);
    // 200 to keep retrying providers quiet; error is in logs.
    return jsonResponse({ ok: false, error: "internal" });
  }
}
