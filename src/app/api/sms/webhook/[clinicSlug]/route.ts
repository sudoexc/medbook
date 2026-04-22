/**
 * Multi-tenant SMS inbound webhook (stub).
 *
 * POST /api/sms/webhook/[clinicSlug]
 *
 * Body: { from, to, body, providerId?, externalId? }
 *
 * Responsibilities:
 *   1. Look up the clinic by slug (no session — provider secret would auth).
 *   2. Upsert a Conversation keyed by `(clinicId, externalId || from)` with
 *      `channel = SMS`.
 *   3. Append the incoming message.
 *   4. Publish `tg.message.new` (event bus is channel-agnostic; we attach
 *      `platform: "SMS"` to the payload — Phase 6 can rename the event).
 *
 * Phase 5 is MVP: the real Eskiz/Playmobile signature validation lives in
 * the SMS adapter config. For now, we accept any payload in dev and log a
 * warning if `x-sms-secret` is missing in prod.
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

export async function POST(request: Request): Promise<Response> {
  const slug = extractSlug(request);
  if (!slug) {
    return Response.json({ error: "Missing clinicSlug" }, { status: 400 });
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

  const foundClinic = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findUnique({
      where: { slug },
      select: { id: true },
    }),
  );
  if (!foundClinic) {
    return Response.json({ error: "UnknownClinic" }, { status: 404 });
  }

  // In prod, require `x-sms-secret`. Dev: warn + accept.
  const secretHeader = request.headers.get("x-sms-secret");
  if (!secretHeader && process.env.NODE_ENV === "production") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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
