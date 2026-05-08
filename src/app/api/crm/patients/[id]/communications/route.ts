/**
 * /api/crm/patients/[id]/communications — unified timeline of touches.
 *
 * Aggregates the full event-stream for one patient:
 *   - Communication / Message / Call / NotificationSend / Appointment(visit)
 *     (the original Phase 6.5.7 scope)
 *   - Phase 12: Payment(PAID) / Document / MedicalCase(opened/closed) /
 *     AuditLog(APPOINTMENT_RESCHEDULED) so the patient-card timeline can
 *     render the full lifecycle in one feed.
 *
 * Response shape (backward-compatible — only adds fields):
 *   { items: Array<{
 *       id, kind, at,
 *       channel?, direction?, title, body?, meta?,
 *       category: "VISIT" | "PAYMENT" | "COMM" | "DOC"
 *     }> }
 *
 * The drawer's `usePatientTimeline` keeps working because we only **add**
 * the optional `category` field — every previous field is preserved.
 *
 * Tenancy: the `createApiListHandler` wrapper builds a TENANT context, and
 * the `prisma` client below is the tenant-scoped extension (see
 * `src/lib/prisma.ts`). All `clinicId` filters happen automatically.
 *
 * Limit: caller may pass `?limit=N` to cap final items (default 200).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../patients/[id]/communications
  return parts[parts.length - 2] ?? "";
}

type Category = "VISIT" | "PAYMENT" | "COMM" | "DOC";

type Item = {
  id: string;
  kind: string;
  at: Date;
  channel?: string;
  direction?: string;
  title: string;
  body?: string | null;
  meta?: unknown;
  category: Category;
};

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request }) => {
    const patientId = idFromUrl(request);
    const url = new URL(request.url);
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const finalLimit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 200;

    const [
      communications,
      calls,
      sends,
      visits,
      messages,
      payments,
      documents,
      cases,
    ] = await Promise.all([
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
        select: {
          id: true,
          date: true,
          status: true,
          comments: true,
          priceFinal: true,
          doctor: { select: { nameRu: true } },
        },
      }),
      prisma.message.findMany({
        where: { conversation: { patientId } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.payment.findMany({
        where: { patientId, status: "PAID" },
        orderBy: { paidAt: "desc" },
        take: 50,
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          paidAt: true,
          createdAt: true,
          appointmentId: true,
          receiptNumber: true,
        },
      }),
      prisma.document.findMany({
        where: { patientId },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          title: true,
          fileUrl: true,
          mimeType: true,
          createdAt: true,
        },
      }),
      prisma.medicalCase.findMany({
        where: { patientId },
        orderBy: { openedAt: "desc" },
        take: 50,
        select: {
          id: true,
          title: true,
          status: true,
          openedAt: true,
          closedAt: true,
          closedReason: true,
        },
      }),
    ]);

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
        category: "COMM",
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
        category: "COMM",
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
        category: "COMM",
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
        meta: {
          appointmentId: v.id,
          status: v.status,
          priceFinal: v.priceFinal,
          doctor: { nameRu: v.doctor.nameRu },
        },
        category: "VISIT",
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
        category: "COMM",
      });
    }
    for (const p of payments) {
      // Prefer paidAt; if missing for any reason fall back to updatedAt/createdAt.
      const at = p.paidAt ?? p.createdAt;
      items.push({
        id: `pay:${p.id}`,
        kind: "payment",
        at,
        title: p.receiptNumber
          ? `Оплата · ${p.receiptNumber}`
          : "Оплата",
        body: null,
        meta: {
          amount: p.amount,
          currency: p.currency,
          method: p.method,
          appointmentId: p.appointmentId,
        },
        category: "PAYMENT",
      });
    }
    for (const d of documents) {
      items.push({
        id: `doc:${d.id}`,
        kind: "document",
        at: d.createdAt,
        title: d.title,
        body: d.mimeType ?? null,
        meta: { type: d.type, fileUrl: d.fileUrl, mimeType: d.mimeType },
        category: "DOC",
      });
    }
    for (const k of cases) {
      items.push({
        id: `case-open:${k.id}`,
        kind: "case",
        at: k.openedAt,
        title: k.title,
        body: null,
        meta: { action: "opened", caseId: k.id, status: k.status },
        category: "VISIT",
      });
      if (k.closedAt) {
        items.push({
          id: `case-close:${k.id}`,
          kind: "case",
          at: k.closedAt,
          title: k.title,
          body: k.closedReason ?? null,
          meta: { action: "closed", caseId: k.id, closedReason: k.closedReason },
          category: "VISIT",
        });
      }
    }

    // Reschedule audit rows. We don't have AuditLog.patientId, so scope by the
    // appointments we already touched in this clinic — single query, no N+1.
    // We fetch a shallow list of all appointment ids for the patient first
    // (cheap, indexed by clinicId+patientId), then a single AuditLog lookup
    // bounded to those entityIds.
    const apptIds = await prisma.appointment.findMany({
      where: { patientId },
      select: { id: true },
      take: 500,
    });
    if (apptIds.length > 0) {
      const ids = apptIds.map((a) => a.id);
      const reschedules = await prisma.auditLog.findMany({
        where: {
          action: "APPOINTMENT_RESCHEDULED",
          entityType: "Appointment",
          entityId: { in: ids },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          createdAt: true,
          entityId: true,
          meta: true,
          actorLabel: true,
        },
      });
      for (const r of reschedules) {
        items.push({
          id: `resched:${r.id}`,
          kind: "reschedule",
          at: r.createdAt,
          title: "Перенос записи",
          body: r.actorLabel ?? null,
          meta: {
            appointmentId: r.entityId,
            ...((r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : {})),
          },
          category: "VISIT",
        });
      }
    }

    items.sort((a, b) => b.at.getTime() - a.at.getTime());
    return ok({ items: items.slice(0, finalLimit) });
  }
);
