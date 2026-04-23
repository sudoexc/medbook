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

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { publishEventSafe } from "@/server/realtime/publish";

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

  const conversationId = await runWithTenant(
    { kind: "SYSTEM" },
    async () => {
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

      return conv.id;
    },
  );

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
