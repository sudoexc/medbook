/**
 * SIP provider webhook.
 *
 * POST /api/calls/sip/event
 *
 * Generic payload contract, normalized from real providers by adapter code.
 * The schema is intentionally loose — every provider (OnlinePBX / Mango /
 * Asterisk ARI / UIS) has a different shape, and we expect the adapter layer
 * to map it to this canonical JSON before hitting this endpoint. The input
 * rules (timestamp formats, secret check, operator mapping) live in
 * `@/server/telephony/sip-event`.
 *
 * Security model (§6.7.5):
 *   - Webhook secret verified against the clinic's `ProviderConnection.config.webhookSecret`,
 *     sent in the `x-sip-secret` header only (audit CM-01: a query-string
 *     secret lands in access logs, so it is ignored).
 *   - When no secret is configured, dev mode accepts the request but logs a loud
 *     warning so the omission shows up in logs.
 *   - GET (and any non-POST) → 405.
 *
 * Tenant model: the webhook cannot use NextAuth. We receive `clinicSlug` via
 * query string (or `x-clinic-slug` header) and run under `runWithTenant(SYSTEM)`
 * with explicit `clinicId` in every Prisma call.
 *
 * Errors (audit CM-01): a failed write answers 500 so the provider retries
 * the event. It used to answer 200 «to keep retrying providers quiet», and
 * the event was simply gone: the call never reached the queue. Since a retry
 * can arrive after later events of the same call, every handler is safe out
 * of order (see the rules in `@/lib/calls/call-state`).
 *
 * Event semantics vs the `Call` model:
 *   - ringing  → upsert Call(status=RINGING, startedAt=evt.ts, direction=IN).
 *                A late ringing for a call that is already over changes
 *                nothing but the patient link.
 *   - answered → status=ANSWERED, answeredAt=evt.ts. We still push the legacy
 *                `tags.answered` for any read-path that hasn't migrated to
 *                `status` yet. Never reopens a finished call; a call we closed
 *                as missed only because no answer had arrived yet becomes
 *                ENDED with its talk time when the answer predates the end.
 *   - hangup   → endedAt; answered → ENDED with durationSec = talk time
 *                (endedAt - answeredAt), otherwise MISSED with
 *                direction=MISSED and no duration (audit CM-10).
 *   - missed   → status=MISSED + direction=MISSED + endedAt (no duration).
 *                Ignored for a call somebody already answered: that is
 *                another operator's leg, the hangup will close the call.
 *
 * A RINGING call whose hangup never arrives is closed as missed by the
 * call sweep worker (`src/server/workers/call-sweep.ts`).
 *
 * TODO(admin-platform-builder): expose `ProviderConnection` settings UI so the
 * webhook secret can be rotated without a DB edit.
 */

import type { NextRequest } from "next/server";

import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneSearchVariants } from "@/lib/phone";
import { runWithTenant } from "@/lib/tenant-context";
import {
  hangupUpdate,
  isCallOver,
  missedUpdate,
  talkSeconds,
  wasCallAnswered,
  type CallCloseUpdate,
} from "@/lib/calls/call-state";
import { CALL_CHANNELS, TELEPHONY_CHANNELS } from "@/server/telephony/adapter";
import {
  operatorCandidate,
  readExtensionMap,
  sipSecretMatches,
  SipEventSchema,
  type SipEvent,
} from "@/server/telephony/sip-event";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { publish } from "@/server/realtime/event-bus";
import { publishEventSafe } from "@/server/realtime/publish";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: "Method Not Allowed" }, 405);
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PATCH = methodNotAllowed;

type ResolvedClinic = {
  id: string;
  slug: string;
  webhookSecret: string | null;
  /** PBX extension → CRM user id (`config.extensions`). */
  extensions: Record<string, string>;
};

async function resolveClinic(request: NextRequest): Promise<ResolvedClinic | null> {
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
    return {
      id: clinic.id,
      slug: clinic.slug,
      webhookSecret,
      extensions: readExtensionMap(conn?.config),
    };
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
    // Only the verified owner of the number (audit PH-01): a number a
    // Telegram user typed into the Mini App proves nothing, and showing his
    // card as «the caller» invites reception to book the real caller into
    // it. A relative who uses the number as a contact is not the caller's
    // identity either.
    const match = await prisma.patient.findFirst({
      where: {
        clinicId,
        phoneNormalized: { in: variants },
        phoneVerifiedAt: { not: null },
      },
      select: { id: true },
    });
    return match?.id ?? null;
  });
}

/**
 * The CRM user behind the event's operator, or null. `Call.operatorId` is a
 * foreign key to User: writing the PBX extension «101» into it failed the
 * whole insert, and the call never reached the queue (audit CM-01).
 */
async function resolveOperatorId(
  clinic: ResolvedClinic,
  evt: SipEvent,
): Promise<string | null> {
  const candidate = operatorCandidate(evt.operatorId, clinic.extensions);
  if (!candidate) return null;
  const user = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.user.findFirst({
      where: { id: candidate, clinicId: clinic.id, active: true },
      select: { id: true },
    }),
  );
  if (!user) {
    console.warn(
      `[sip:webhook clinic=${clinic.slug}] unknown operator "${evt.operatorId}": call kept without an operator`,
    );
  }
  return user?.id ?? null;
}

const CALL_STATE_SELECT = {
  id: true,
  direction: true,
  status: true,
  answeredAt: true,
  endedAt: true,
  tags: true,
  patientId: true,
  operatorId: true,
  recordingUrl: true,
} as const;

/** What a close event did: the realtime event to send, or nothing. */
type CloseOutcome = "ENDED" | "MISSED" | null;

async function handleRinging(
  clinic: ResolvedClinic,
  evt: SipEvent,
): Promise<{ dbId: string; patientId: string | null; live: boolean }> {
  const [patientId, operatorId] = await Promise.all([
    linkPatientByPhone(clinic.id, evt.from),
    resolveOperatorId(clinic, evt),
  ]);
  const createdAt = evt.timestamp;

  const row = await runWithTenant({ kind: "SYSTEM" }, async () =>
    prisma.call.upsert({
      where: { clinicId_sipCallId: { clinicId: clinic.id, sipCallId: evt.callId } },
      create: {
        clinicId: clinic.id,
        direction: "IN",
        status: "RINGING",
        fromNumber: evt.from,
        toNumber: evt.to,
        sipCallId: evt.callId,
        patientId,
        operatorId,
        createdAt,
        startedAt: createdAt,
        recordingUrl: evt.recordingUrl ?? null,
      },
      update: {
        // Re-ringing (or a retried ringing that lands after the hangup):
        // never touch the status, and don't clobber patientId if we already
        // linked it.
        patientId: patientId ?? undefined,
        recordingUrl: evt.recordingUrl ?? undefined,
      },
      select: { id: true, patientId: true, status: true, endedAt: true },
    }),
  );
  if (row.patientId) {
    await bumpPatientLastContact(row.patientId, createdAt);
  }
  return {
    dbId: row.id,
    patientId: row.patientId,
    live: !isCallOver(row),
  };
}

async function handleAnswered(
  clinic: ResolvedClinic,
  evt: SipEvent,
): Promise<{ applied: boolean }> {
  const operatorId = await resolveOperatorId(clinic, evt);
  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId: clinic.id, sipCallId: evt.callId } },
      select: CALL_STATE_SELECT,
    });
    if (!existing) {
      // Out-of-order event: create a minimal IN row so hangup has something
      // to update. Direction defaults to IN (operator answered something).
      const linked = await linkPatientByPhone(clinic.id, evt.from);
      await prisma.call.create({
        data: {
          clinicId: clinic.id,
          direction: "IN",
          status: "ANSWERED",
          fromNumber: evt.from,
          toNumber: evt.to,
          sipCallId: evt.callId,
          operatorId,
          patientId: linked,
          tags: ["answered"],
          createdAt: evt.timestamp,
          startedAt: evt.timestamp,
          answeredAt: evt.timestamp,
        },
      });
      return { applied: true, patientId: linked };
    }
    const nextTags = existing.tags.includes("answered")
      ? existing.tags
      : [...existing.tags, "answered"];
    if (isCallOver(existing)) {
      // Never reopen a finished call (audit CM-01): a late answered used to
      // flip it back to ANSWERED, and it hung in «В разговоре» for good.
      // One exception keeps the record true: the hangup closed it as missed
      // only because this answer had not arrived yet.
      const answeredBeforeEnd =
        existing.status === "MISSED" &&
        existing.answeredAt === null &&
        existing.endedAt !== null &&
        evt.timestamp.getTime() <= existing.endedAt.getTime();
      if (!answeredBeforeEnd) return { applied: false, patientId: existing.patientId };
      await prisma.call.update({
        where: { id: existing.id },
        data: {
          status: "ENDED",
          ...(existing.direction === "MISSED" ? { direction: "IN" as const } : {}),
          answeredAt: evt.timestamp,
          durationSec: talkSeconds(evt.timestamp, existing.endedAt!),
          tags: nextTags,
          operatorId: operatorId ?? existing.operatorId ?? undefined,
        },
      });
      return { applied: true, patientId: existing.patientId };
    }
    await prisma.call.update({
      where: { id: existing.id },
      data: {
        status: "ANSWERED",
        // A re-delivered answer keeps the first moment: the talk time
        // starts there.
        answeredAt: existing.answeredAt ?? evt.timestamp,
        tags: nextTags,
        operatorId: operatorId ?? existing.operatorId ?? undefined,
      },
    });
    return { applied: true, patientId: existing.patientId };
  });
  if (result.applied && result.patientId) {
    await bumpPatientLastContact(result.patientId, evt.timestamp);
  }
  return { applied: result.applied };
}

/**
 * Close a live call with `data`, only while it is still live: the operator's
 * «Завершить» or the sweep may have closed it a moment ago.
 */
async function closeIfLive(
  id: string,
  data: CallCloseUpdate & { recordingUrl?: string },
): Promise<boolean> {
  const res = await prisma.call.updateMany({
    where: { id, endedAt: null },
    data,
  });
  return res.count > 0;
}

async function handleHangup(
  clinic: ResolvedClinic,
  evt: SipEvent,
): Promise<{ dbId: string; outcome: CloseOutcome }> {
  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId: clinic.id, sipCallId: evt.callId } },
      select: CALL_STATE_SELECT,
    });
    if (!existing) {
      // The ringing never reached us (lost, or still being retried). The
      // call happened and nobody is known to have answered it: record it as
      // missed so it is called back, instead of dropping the event.
      const patientId = await linkPatientByPhone(clinic.id, evt.from);
      const created = await prisma.call.create({
        data: {
          clinicId: clinic.id,
          direction: "MISSED",
          status: "MISSED",
          fromNumber: evt.from,
          toNumber: evt.to,
          sipCallId: evt.callId,
          patientId,
          createdAt: evt.timestamp,
          startedAt: evt.timestamp,
          endedAt: evt.timestamp,
          durationSec: null,
          recordingUrl: evt.recordingUrl ?? null,
        },
        select: { id: true },
      });
      return { dbId: created.id, patientId, outcome: "MISSED" as CloseOutcome };
    }
    if (isCallOver(existing)) {
      // Closed already (operator, sweep, an earlier hangup). A recording
      // that arrives with the late hangup is still worth keeping.
      if (evt.recordingUrl && !existing.recordingUrl) {
        await prisma.call.update({
          where: { id: existing.id },
          data: { recordingUrl: evt.recordingUrl },
        });
      }
      return { dbId: existing.id, patientId: existing.patientId, outcome: null };
    }
    const data = hangupUpdate(existing, evt.timestamp);
    const closed = await closeIfLive(existing.id, {
      ...data,
      ...(evt.recordingUrl ? { recordingUrl: evt.recordingUrl } : {}),
    });
    return {
      dbId: existing.id,
      patientId: existing.patientId,
      outcome: closed ? (data.status as CloseOutcome) : null,
    };
  });
  if (result.patientId && result.outcome) {
    await bumpPatientLastContact(result.patientId, evt.timestamp);
  }
  return { dbId: result.dbId, outcome: result.outcome };
}

async function handleMissed(
  clinic: ResolvedClinic,
  evt: SipEvent,
): Promise<{ dbId: string; outcome: CloseOutcome }> {
  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const existing = await prisma.call.findUnique({
      where: { clinicId_sipCallId: { clinicId: clinic.id, sipCallId: evt.callId } },
      select: CALL_STATE_SELECT,
    });
    if (existing) {
      // Over already, or somebody picked it up (this «missed» is another
      // operator's leg; the hangup closes the call): nothing to record.
      if (isCallOver(existing) || wasCallAnswered(existing)) {
        return { dbId: existing.id, patientId: existing.patientId, outcome: null };
      }
      const closed = await closeIfLive(existing.id, missedUpdate(existing, evt.timestamp));
      return {
        dbId: existing.id,
        patientId: existing.patientId,
        outcome: closed ? ("MISSED" as CloseOutcome) : null,
      };
    }
    // No prior ringing event — create a MISSED row.
    const patientId = await linkPatientByPhone(clinic.id, evt.from);
    const created = await prisma.call.create({
      data: {
        clinicId: clinic.id,
        direction: "MISSED",
        status: "MISSED",
        fromNumber: evt.from,
        toNumber: evt.to,
        sipCallId: evt.callId,
        createdAt: evt.timestamp,
        startedAt: evt.timestamp,
        endedAt: evt.timestamp,
        durationSec: null,
        patientId,
      },
      select: { id: true },
    });
    return { dbId: created.id, patientId, outcome: "MISSED" as CloseOutcome };
  });
  if (result.patientId && result.outcome) {
    await bumpPatientLastContact(result.patientId, evt.timestamp);
  }
  return { dbId: result.dbId, outcome: result.outcome };
}

/** Provider fields first: they must never override ours (clinicId, dbId). */
function withProviderMeta(
  evt: SipEvent,
  own: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(evt.meta ?? {}), ...own };
}

function publishClose(
  clinicId: string,
  evt: SipEvent,
  dbId: string,
  outcome: Exclude<CloseOutcome, null>,
): void {
  const missed = outcome === "MISSED";
  publish(missed ? TELEPHONY_CHANNELS.missed : TELEPHONY_CHANNELS.hangup, {
    kind: missed ? "missed" : "hangup",
    callId: evt.callId,
    from: evt.from,
    to: evt.to,
    timestamp: evt.timestamp,
    meta: withProviderMeta(evt, { clinicId, dbId }),
  });
  publish(CALL_CHANNELS.ended, {
    callId: evt.callId,
    clinicId,
    dbId,
    ...(missed ? { missed: true } : {}),
  });
  publishEventSafe(clinicId, {
    type: missed ? "call.missed" : "call.ended",
    payload: { callId: evt.callId, dbId, from: evt.from, to: evt.to },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const clinic = await resolveClinic(request);
    if (!clinic) return jsonResponse({ error: "Clinic not found" }, 404);

    // Header only (audit CM-01). A secret still configured in the query
    // string is refused below and named in the log so the PBX side is fixed.
    const providedSecret = request.headers.get("x-sip-secret") ?? "";
    if (!providedSecret && new URL(request.url).searchParams.has("secret")) {
      console.warn(
        `[sip:webhook clinic=${clinic.slug}] secret sent in the query string is ignored: send it in the x-sip-secret header`,
      );
    }
    if (clinic.webhookSecret) {
      if (!sipSecretMatches(providedSecret, clinic.webhookSecret)) {
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
    const parsed = SipEventSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        { error: "ValidationError", issues: parsed.error.issues },
        400,
      );
    }
    const evt = parsed.data;

    switch (evt.kind) {
      case "ringing": {
        const { dbId, patientId, live } = await handleRinging(clinic, evt);
        // A retried ringing for a call that is already over announces
        // nothing: the operators would get a toast for a finished call.
        if (!live) break;
        publish(TELEPHONY_CHANNELS.ringing, {
          kind: "ringing",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: withProviderMeta(evt, { dbId, patientId, clinicId: clinic.id }),
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
        publishEventSafe(clinic.id, {
          type: "call.incoming",
          payload: {
            callId: evt.callId,
            dbId,
            direction: "IN",
            from: evt.from,
            to: evt.to,
            patientId,
          },
        });
        break;
      }
      case "answered": {
        const { applied } = await handleAnswered(clinic, evt);
        if (!applied) break;
        publish(TELEPHONY_CHANNELS.answered, {
          kind: "answered",
          callId: evt.callId,
          from: evt.from,
          to: evt.to,
          timestamp: evt.timestamp,
          meta: withProviderMeta(evt, { clinicId: clinic.id }),
        });
        publish(CALL_CHANNELS.answered, {
          callId: evt.callId,
          clinicId: clinic.id,
          operatorId: evt.operatorId ?? null,
        });
        publishEventSafe(clinic.id, {
          type: "call.answered",
          payload: {
            callId: evt.callId,
            operatorId: evt.operatorId ?? null,
            from: evt.from,
            to: evt.to,
          },
        });
        break;
      }
      case "hangup":
      case "missed": {
        const res =
          evt.kind === "hangup"
            ? await handleHangup(clinic, evt)
            : await handleMissed(clinic, evt);
        if (res.outcome) publishClose(clinic.id, evt, res.dbId, res.outcome);
        break;
      }
    }
    return jsonResponse({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[sip:webhook] error: ${message}`);
    // 5xx so the provider retries; the handlers are safe to replay.
    return jsonResponse({ error: "internal" }, 500);
  }
}
