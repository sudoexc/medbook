/**
 * /api/crm/online-requests/[id] — one site booking request (`Lead`):
 * GET, and PATCH for the status reception sets after the call (contacted /
 * cancelled / back to new) and the operator's note. See docs/TZ.md §6.7.
 *
 * Conversion into a patient + appointment is not done here: reception books
 * through the regular appointment dialog with `leadId`, and bookAppointment
 * links the lead and marks it CONVERTED in the same transaction.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff, err } from "@/server/http";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import {
  ONLINE_REQUEST_ROLES,
  UpdateOnlineRequestSchema,
  type UpdateOnlineRequest,
} from "@/server/schemas/online-request";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

const LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  service: true,
  date: true,
  status: true,
  source: true,
  comment: true,
  createdAt: true,
  updatedAt: true,
  doctorId: true,
  doctor: { select: { id: true, nameRu: true, nameUz: true } },
  patient: { select: { id: true, fullName: true } },
  appointment: { select: { id: true, date: true, time: true } },
} as const;

export const GET = createApiListHandler(
  { roles: [...ONLINE_REQUEST_ROLES] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const row = await prisma.lead.findFirst({
      where: { id },
      select: LEAD_SELECT,
    });
    if (!row) return notFound();
    return ok(row);
  },
);

export const PATCH = createApiHandler<UpdateOnlineRequest>(
  {
    roles: [...ONLINE_REQUEST_ROLES],
    bodySchema: UpdateOnlineRequestSchema,
  },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    const before = await prisma.lead.findFirst({
      where: { id },
      select: { id: true, status: true, comment: true, name: true, doctorId: true },
    });
    if (!before) return notFound();

    const data: { status?: UpdateOnlineRequest["status"]; comment?: string | null } = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.comment !== undefined) data.comment = body.comment || null;

    // Row + event in one transaction, so every operator's «Заявки» screen and
    // sidebar badge follow the change (two people must not call the same
    // person because one screen was stale).
    const after = await prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data,
        select: LEAD_SELECT,
      });
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: ctx.role === "ADMIN" || ctx.role === "SUPER_ADMIN" ? "ADMIN" : "RECEPTIONIST",
          userId: ctx.userId,
          patientId: null,
          onBehalfOfPatientId: null,
          label: `user:${ctx.userId}`,
        },
        surface: ctx.role === "CALL_OPERATOR" ? "CALL_CENTER" : "CRM",
        tenantScope: {
          clinicId: ctx.clinicId,
          ...(updated.doctorId ? { doctorId: updated.doctorId } : {}),
        },
        type: "lead.updated",
        payload: {
          leadId: updated.id,
          status: updated.status,
          name: updated.name,
          doctorId: updated.doctorId,
        },
      });
      return updated;
    });

    const d = diff(
      { status: before.status, comment: before.comment },
      { status: after.status, comment: after.comment },
    );
    await audit(request, {
      action: "online-request.update",
      entityType: "Lead",
      entityId: id,
      meta: d,
    });
    return ok(after);
  },
);
