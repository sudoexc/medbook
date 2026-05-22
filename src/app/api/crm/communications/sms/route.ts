/**
 * /api/crm/communications/sms — outbound SMS.
 * See docs/TZ.md §6.4.
 *
 * Dispatches via `resolveAdapters(clinicId).sms.send()`. When no provider is
 * configured, the LogOnly adapter records the message in DB but doesn't hit
 * an external service — the response surfaces `adapter` + `real` so the
 * caller can tell whether a real SMS was actually billed.
 *
 * Persistence (two-track on purpose):
 *
 *   - `Communication` — audit trail per outbound send. Kept because the
 *     patient page's communications tab + bulk reminder accounting already
 *     read from it.
 *   - `Conversation` + `Message` — upserted by `sms:<phone>` so the same
 *     thread is shared with the inbound webhook (`/api/sms/webhook`) and
 *     the SMS inbox composer. Without this, a quick-send from the patient
 *     page was silently invisible to the inbox view of the same thread.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err } from "@/server/http";
import { SendSmsSchema } from "@/server/schemas/communication";
import { resolveAdapters } from "@/server/notifications/adapters";
import { publishEventSafe } from "@/server/realtime/publish";
import { bumpPatientLastContact } from "@/server/patient/last-contacted";
import { normalizePhone } from "@/lib/phone";

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "CALL_OPERATOR"],
    bodySchema: SendSmsSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const adapters = await resolveAdapters(ctx.clinicId);
    const adapterName = adapters.sms.name;
    const real = adapters.real.sms;

    let providerId: string | null = null;
    let status: "SENT" | "FAILED" = "SENT";
    let failedReason: string | null = null;
    try {
      const res = await adapters.sms.send(body.phone, body.body);
      providerId = res.providerId;
    } catch (e) {
      status = "FAILED";
      failedReason = e instanceof Error ? e.message : String(e);
    }

    const comm = await prisma.communication.create({
      data: {
        patientId: body.patientId ?? null,
        channel: "SMS",
        direction: "OUT",
        subject: null,
        body: body.body,
        meta: {
          phone: body.phone,
          adapter: adapterName,
          real,
          status,
          providerId,
          ...(failedReason ? { failedReason } : {}),
        },
      } as never,
    });

    // Mirror the send onto the shared Conversation/Message thread so the SMS
    // inbox surfaces it. The thread is keyed by `sms:<E.164>` — matching the
    // inbound webhook — so the operator sees a single thread per phone.
    const phoneNorm = normalizePhone(body.phone) ?? body.phone;
    const externalId = `sms:${phoneNorm}`;
    const senderId = ctx.userId;
    let conversationId: string | null = null;
    let messageId: string | null = null;
    try {
      const result = await prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.upsert({
          where: {
            clinicId_externalId: {
              clinicId: ctx.clinicId,
              externalId,
            },
          },
          create: {
            clinicId: ctx.clinicId,
            channel: "SMS",
            mode: "takeover",
            patientId: body.patientId ?? null,
            externalId,
            status: "OPEN",
            assignedToId: senderId,
            lastMessageAt: new Date(),
            lastMessageText: body.body.slice(0, 500),
          },
          update: {
            lastMessageAt: new Date(),
            lastMessageText: body.body.slice(0, 500),
            ...(body.patientId ? { patientId: body.patientId } : {}),
          },
          select: { id: true },
        });
        const created = await tx.message.create({
          data: {
            clinicId: ctx.clinicId,
            conversationId: conv.id,
            direction: "OUT",
            body: body.body,
            senderId,
            status: status === "SENT" ? "SENT" : "FAILED",
            externalId: providerId,
          } as never,
          select: { id: true },
        });
        return { conversationId: conv.id, messageId: created.id };
      });
      conversationId = result.conversationId;
      messageId = result.messageId;
      publishEventSafe(ctx.clinicId, {
        type: "tg.message.new",
        payload: {
          conversationId,
          messageId,
          direction: "OUT",
          preview: body.body.slice(0, 200),
        },
      });
    } catch (e) {
      // Conversation mirror is best-effort — the Communication row still
      // exists as the source of truth for audit. Log so we notice if this
      // happens in prod.
      console.error(
        `[crm:sms] failed to mirror to conversation: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (status === "SENT" && body.patientId) {
      await bumpPatientLastContact(body.patientId, comm.createdAt);
    }

    await audit(request, {
      action: "communication.sms.send",
      entityType: "Communication",
      entityId: comm.id,
      meta: {
        phone: body.phone,
        adapter: adapterName,
        real,
        status,
        conversationId,
        messageId,
        ...(failedReason ? { failedReason } : {}),
      },
    });

    if (status === "FAILED") {
      return err("SmsSendFailed", 502, {
        id: comm.id,
        adapter: adapterName,
        real,
        failedReason,
        conversationId,
      });
    }
    return ok(
      {
        id: comm.id,
        status: "sent",
        adapter: adapterName,
        real,
        providerId,
        conversationId,
        messageId,
      },
      202,
    );
  }
);
