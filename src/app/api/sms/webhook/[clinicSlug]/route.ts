/**
 * Multi-tenant SMS inbound webhook.
 *
 * POST /api/sms/webhook/[clinicSlug]
 *
 * Body: { from, to, body, providerId?, externalId? }
 *
 * Responsibilities:
 *   1. Look up the clinic by slug (no session).
 *   2. Verify the `x-sms-secret` header against the clinic's active
 *      `ProviderConnection` (`kind = SMS`, `config.webhookSecret`).
 *      Constant-time compare, 401 on mismatch. In production the secret
 *      MUST be configured — otherwise we reject.
 *   3. Upsert a Conversation keyed by `(clinicId, externalId || from)` with
 *      `channel = SMS`.
 *   4. Append the incoming message.
 *   5. Publish `tg.message.new` (event bus is channel-agnostic; we attach
 *      `platform: "SMS"` to the payload — Phase 6 can rename the event).
 *
 * Security model mirrors `/api/calls/sip/event` (§6.7.5): the shared pattern
 * lives in `docs/security/checklist.md` (Authentication bullet 4).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { normalizePhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { isStopKeyword, stopReply } from "@/lib/sms-stop";
import { runWithTenant } from "@/lib/tenant-context";
import { confirmAppointment } from "@/server/appointments/confirm";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { publishEventSafe } from "@/server/realtime/publish";

/**
 * Phase 17 — appointment confirmation via SMS reply.
 *
 * The T-1d / T-2h reminder CTA tells patients to reply "YES" (or one of the
 * locale variants). We normalize the inbound body to uppercase, strip
 * punctuation/whitespace, and match against this token set. The match policy
 * mirrors `isStopKeyword` — the whole message must be the token (after
 * stripping), so "yes please" or "ha rahmat" do NOT confirm. Loose matching
 * would risk silently flipping the wrong appointment for chatty patients.
 */
const CONFIRM_TOKENS = new Set<string>(["YES", "Y", "ДА", "DA", "HA"]);

function isConfirmKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  // Strip whitespace and punctuation, uppercase. Leave letters (Cyrillic
  // included) and digits — the token set has no digits but the strip rule
  // is identical to what we'd want for any future expansion.
  const stripped = text
    .toUpperCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
  if (!stripped) return false;
  return CONFIRM_TOKENS.has(stripped);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  from: z.string().min(1),
  to: z.string().optional(),
  body: z.string().min(1),
  providerId: z.string().optional(),
  externalId: z.string().optional(),
});

function extractSlug(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "webhook");
  if (idx < 0) return null;
  return parts[idx + 1] ?? null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function resolveClinicSecret(
  clinicId: string,
): Promise<string | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const conn = await prisma.providerConnection.findFirst({
      where: { clinicId, active: true, kind: "SMS" },
      select: { config: true },
    });
    if (!conn?.config || typeof conn.config !== "object" || Array.isArray(conn.config)) {
      return null;
    }
    const cfg = conn.config as Record<string, unknown>;
    const raw = cfg.webhookSecret;
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  });
}

export async function POST(request: Request): Promise<Response> {
  const slug = extractSlug(request);
  if (!slug) {
    return Response.json({ error: "Missing clinicSlug" }, { status: 400 });
  }

  const foundClinic = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findUnique({
      where: { slug },
      select: { id: true, slug: true },
    }),
  );
  if (!foundClinic) {
    return Response.json({ error: "UnknownClinic" }, { status: 404 });
  }

  // Signature verification (mirrors SIP webhook). In prod a secret MUST be
  // configured — otherwise we reject. In dev we accept but log a warning so
  // the omission shows up in logs.
  const providedSecret = request.headers.get("x-sms-secret") ?? "";
  const storedSecret = await resolveClinicSecret(foundClinic.id);
  if (storedSecret) {
    if (!safeEqual(providedSecret, storedSecret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "Webhook secret not configured" },
      { status: 401 },
    );
  } else {
    console.warn(
      `[sms:webhook clinic=${foundClinic.slug}] no webhookSecret configured — accepting in dev mode`,
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "InvalidJson" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "ValidationError", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { from, to, body, externalId } = parsed.data;

  const conversationResult = await runWithTenant(
    { kind: "SYSTEM" },
    async (): Promise<{ id: string; patientId: string | null }> => {
      // We use `externalId` as the unique per-clinic key when provided; else
      // fall back to the sender phone so repeat messages stitch into one thread.
      const externalKey = externalId ?? `sms:${from}`;

      // Upsert conversation.
      const existing = await prisma.conversation.findUnique({
        where: {
          clinicId_externalId: {
            clinicId: foundClinic.id,
            externalId: externalKey,
          },
        },
        select: { id: true },
      });

      // Try to match a patient by phone.
      const normalized = from.replace(/\D/g, "");
      const patient = normalized
        ? await prisma.patient.findFirst({
            where: {
              clinicId: foundClinic.id,
              phoneNormalized: { contains: normalized },
            },
            select: { id: true },
          })
        : null;

      let conv = existing;
      if (!conv) {
        conv = await prisma.conversation.create({
          data: {
            clinicId: foundClinic.id,
            channel: "SMS",
            mode: "bot",
            externalId: externalKey,
            patientId: patient?.id ?? null,
            lastMessageText: body,
            lastMessageAt: new Date(),
            unreadCount: 1,
          },
          select: { id: true },
        });
      } else {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            lastMessageText: body,
            lastMessageAt: new Date(),
            unreadCount: { increment: 1 },
            ...(patient ? { patientId: patient.id } : {}),
          },
        });
      }

      await prisma.message.create({
        data: {
          clinicId: foundClinic.id,
          conversationId: conv.id,
          direction: "IN",
          body,
          externalId: externalId ?? null,
        },
      });

      return { id: conv.id, patientId: patient?.id ?? null };
    },
  );
  const conversationId = conversationResult.id;
  if (conversationResult.patientId) {
    await bumpPatientLastContact(conversationResult.patientId);
  }

  // Phase 17 Wave 1 — SMS STOP keyword handling.
  //
  // We match the inbound message body against the supported keyword set
  // (English / Russian / Uzbek). When it matches AND the sender phone
  // resolves to one or more known patients within this clinic, we flip
  // their `marketingOptOut` flag, audit it, and queue a confirmation SMS
  // back to the sender. Multiple patients on the same phone — across
  // different clinic accounts — all opt out together; the clinic-slug
  // route already scopes us to one clinic so the "many patients" case
  // here is just two records sharing a phone within ONE clinic.
  if (isStopKeyword(body)) {
    try {
      await runWithTenant({ kind: "SYSTEM" }, async () => {
        const normalized = from.replace(/\D/g, "");
        if (!normalized) return;
        const patients = await prisma.patient.findMany({
          where: {
            clinicId: foundClinic.id,
            phoneNormalized: { contains: normalized },
            marketingOptOut: false,
          },
          select: { id: true, preferredLang: true, phone: true },
        });
        if (patients.length === 0) return;

        const now = new Date();
        await prisma.patient.updateMany({
          where: { id: { in: patients.map((p) => p.id) } },
          data: {
            marketingOptOut: true,
            marketingOptOutAt: now,
            marketingOptOutSource: "sms-stop",
          },
        });
        // One audit row per affected patient — keeps per-row forensics
        // identical to the Mini App opt-out path.
        for (const p of patients) {
          await audit(request, {
            action: AUDIT_ACTION.MARKETING_OPT_OUT_CHANGED,
            entityType: "Patient",
            entityId: p.id,
            meta: { source: "sms-stop", optedOut: true },
          });
        }

        // Queue the confirmation reply back to the sender. We pick the
        // language from the first matching patient — it's their phone, so
        // their preferred language is the right hint. We only enqueue per
        // patient (NotificationSend.patientId is required), so a multi-
        // patient phone gets one reply per row — the SMS provider will
        // dedupe identical body+recipient, and the audit trail still
        // shows a per-patient ack.
        const replyBody = stopReply(
          patients[0]?.preferredLang === "UZ" ? "UZ" : "RU",
        );
        for (const p of patients) {
          try {
            await prisma.notificationSend.create({
              data: {
                clinicId: foundClinic.id,
                patientId: p.id,
                appointmentId: null,
                templateId: null,
                channel: "SMS",
                recipient: p.phone || from,
                body: replyBody,
                scheduledFor: now,
                status: "QUEUED",
              } as never,
            });
          } catch (err) {
            console.error(
              "[sms:webhook] failed to queue STOP reply",
              err,
            );
          }
        }
      });
    } catch (err) {
      console.error("[sms:webhook] STOP keyword handling failed", err);
    }
  }

  // Phase 17 Stage 3.G.1 — appointment confirmation via SMS reply.
  //
  // Layered on top of the STOP handler (and the conversation upsert) so the
  // inbound message is always recorded as a regular conversation row first.
  // Then, if the body matches the YES token set, we resolve sender phone →
  // patient → nearest future unconfirmed appointment, and call the central
  // `confirmAppointment` helper inside a TENANT runWithTenant frame. The
  // helper is idempotent and writes the audit row itself, so we don't add
  // any audit constants here.
  if (isConfirmKeyword(body)) {
    try {
      const canonical = normalizePhone(from);
      const digits = from.replace(/\D/g, "");
      // Find the nearest future unconfirmed appointment for any patient on
      // this phone, scoped to this clinic. Family members share a phone, so
      // we don't try to disambiguate — the soonest one is the one the
      // reminder went out for.
      const match = await runWithTenant({ kind: "SYSTEM" }, async () => {
        if (!canonical && !digits) return null;
        const phoneFilter: Array<{ phoneNormalized: { contains: string } }> =
          [];
        if (canonical) phoneFilter.push({ phoneNormalized: { contains: canonical } });
        if (digits) phoneFilter.push({ phoneNormalized: { contains: digits } });
        const patients = await prisma.patient.findMany({
          where: {
            clinicId: foundClinic.id,
            OR: phoneFilter,
          },
          select: { id: true },
        });
        if (patients.length === 0) return null;

        const now = new Date();
        const appt = await prisma.appointment.findFirst({
          where: {
            clinicId: foundClinic.id,
            patientId: { in: patients.map((p) => p.id) },
            confirmedAt: null,
            status: { notIn: ["CANCELLED", "NO_SHOW", "COMPLETED"] },
            date: { gte: now },
          },
          orderBy: { date: "asc" },
          select: { id: true },
        });
        return appt ? { appointmentId: appt.id } : null;
      });

      if (!match) {
        console.log(
          `[sms-webhook] YES from=${from} clinic=${foundClinic.slug} — no matching unconfirmed appointment`,
        );
      } else {
        // System-initiated TENANT frame (no NextAuth session on this
        // webhook). Same convention as `src/server/actions/scheduler.ts` —
        // synthetic `userId` + ADMIN role so the Prisma extension scopes
        // writes by `clinicId`. The helper writes the audit row with
        // `actorId: null` / `actorLabel: "confirm:SMS_REPLY"`.
        const result = await runWithTenant(
          {
            kind: "TENANT",
            clinicId: foundClinic.id,
            userId: "system:sms-webhook",
            role: "ADMIN",
          },
          () =>
            confirmAppointment({
              appointmentId: match.appointmentId,
              clinicId: foundClinic.id,
              actorId: null,
              via: "SMS_REPLY",
            }),
        );
        if (result.ok) {
          console.log(
            `[sms-webhook] confirm via=SMS_REPLY appointmentId=${match.appointmentId} alreadyConfirmed=${result.alreadyConfirmed}`,
          );
        } else {
          console.log(
            `[sms-webhook] confirm via=SMS_REPLY appointmentId=${match.appointmentId} skipped reason=${result.reason}`,
          );
        }
      }
    } catch (err) {
      // Never 4xx the webhook — most SMS providers retry hard on non-200.
      console.error("[sms-webhook] YES handling failed", err);
    }
  }

  publishEventSafe(foundClinic.id, {
    type: "tg.message.new",
    payload: {
      conversationId,
      platform: "SMS",
      from,
      to: to ?? null,
      preview: body.slice(0, 200),
    },
  });

  return Response.json({ ok: true, conversationId });
}
