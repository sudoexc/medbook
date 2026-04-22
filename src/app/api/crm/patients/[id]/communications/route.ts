/**
 * /api/crm/patients/[id]/communications — unified timeline of touches.
 * Aggregates Communication + Message + Call + NotificationSend + Appointment (visit).
 * See docs/TZ.md §6.5.7.
 *
 * Response shape:
 *   { items: Array<{ id, kind, at, channel?, direction?, title, body?, meta? }> }
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/communications
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const patientId = idFromUrl(request);
    const [communications, calls, sends, visits, messages] = await Promise.all([
      prisma.communication.findMany({
        where: { patientId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.call.findMany({
        where: { patientId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.notificationSend.findMany({
        where: { patientId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.appointment.findMany({
        where: { patientId, status: "COMPLETED" },
        orderBy: { date: "desc" },
        take: 50,
        include: {
          doctor: { select: { nameRu: true } },
        },
      }),
      prisma.message.findMany({
        where: { conversation: { patientId } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    type Item = {
      id: string;
      kind: string;
      at: Date;
      channel?: string;
      direction?: string;
      title: string;
      body?: string | null;
      meta?: unknown;
    };
    const items: Item[] = [];
    for (const c of communications) {
      items.push({
        id: `comm:${c.id}`,
        kind: "communication",
        at: c.createdAt,
        channel: c.channel,
        direction: c.direction,
        title: c.subject ?? c.channel,
        body: c.body,
        meta: c.meta,
      });
    }
    for (const c of calls) {
      items.push({
        id: `call:${c.id}`,
        kind: "call",
        at: c.createdAt,
        channel: "CALL",
        direction: c.direction,
        title:
          c.direction === "IN"
            ? `Входящий звонок ${c.fromNumber}`
            : c.direction === "OUT"
              ? `Исходящий звонок ${c.toNumber}`
              : `Пропущенный ${c.fromNumber}`,
        body: c.summary ?? null,
        meta: { durationSec: c.durationSec, tags: c.tags },
      });
    }
    for (const s of sends) {
      items.push({
        id: `send:${s.id}`,
        kind: "notification",
        at: s.createdAt,
        channel: s.channel,
        direction: "OUT",
        title: `Уведомление (${s.status})`,
        body: s.body,
        meta: {
          status: s.status,
          scheduledFor: s.scheduledFor,
          sentAt: s.sentAt,
        },
      });
    }
    for (const v of visits) {
      items.push({
        id: `visit:${v.id}`,
        kind: "visit",
        at: v.date,
        channel: "VISIT",
        title: `Визит к ${v.doctor.nameRu}`,
        body: v.comments ?? null,
        meta: { appointmentId: v.id, status: v.status },
      });
    }
    for (const m of messages) {
      items.push({
        id: `msg:${m.id}`,
        kind: "message",
        at: m.createdAt,
        channel: "TG",
        direction: m.direction,
        title: m.direction === "IN" ? "Сообщение от пациента" : "Ответ оператора",
        body: m.body,
        meta: { conversationId: m.conversationId, status: m.status },
      });
    }

    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return ok({ items: items.slice(0, 200) });
  }
);
