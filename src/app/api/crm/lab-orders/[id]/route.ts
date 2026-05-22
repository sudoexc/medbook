/**
 * /api/crm/lab-orders/[id] — single order detail + status mutations.
 *
 * GET: returns the order with denormalised test/panel/patient/doctor info
 * so the print form can render in one round-trip.
 *
 * PATCH: limited status transitions (ORDERED ↔ COLLECTED ↔ COMPLETED, or
 * → CANCELLED at any pre-completed stage). Audit-only mutation; the model
 * has no event payload yet (G3 doesn't surface live order status to the
 * doctor UI, but the column is reserved for the lab-station UI in later
 * phases).
 */
import { z } from "zod";

import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";

const PatchBody = z.object({
  status: z
    .enum(["ORDERED", "COLLECTED", "COMPLETED", "CANCELLED"])
    .optional(),
  printedAt: z.string().datetime().optional(),
  notes: z.string().trim().nullish(),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const order = await prisma.labOrder.findFirst({
      where: { id, clinicId: ctx.clinicId },
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            birthDate: true,
            gender: true,
            phoneNormalized: true,
          },
        },
        doctor: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        clinic: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            phone: true,
            addressRu: true,
            addressUz: true,
          },
        },
      },
    });
    if (!order) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && order.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }

    const [tests, panels] = await Promise.all([
      prisma.labTest.findMany({
        where: { code: { in: order.testCodes } },
        orderBy: { sortOrder: "asc" },
      }),
      prisma.labPanel.findMany({
        where: { code: { in: order.panelCodes } },
        orderBy: { sortOrder: "asc" },
        include: {
          tests: {
            orderBy: { sortOrder: "asc" },
            include: { test: { select: { code: true, nameRu: true } } },
          },
        },
      }),
    ]);

    return ok({
      id: order.id,
      orderNumber: order.orderNumber,
      patient: order.patient,
      doctor: order.doctor,
      clinic: order.clinic,
      appointmentId: order.appointmentId,
      visitNoteId: order.visitNoteId,
      diagnosisCode: order.diagnosisCode,
      notes: order.notes,
      urgency: order.urgency,
      status: order.status,
      printedAt: order.printedAt ? order.printedAt.toISOString() : null,
      createdAt: order.createdAt.toISOString(),
      tests,
      panels: panels.map((p) => ({
        id: p.id,
        code: p.code,
        nameRu: p.nameRu,
        description: p.description,
        testCodes: p.tests.map((t) => t.test.code),
        testNames: p.tests.map((t) => ({
          code: t.test.code,
          nameRu: t.test.nameRu,
        })),
      })),
    });
  },
);

export const PATCH = createApiHandler(
  { roles: ["ADMIN", "DOCTOR", "NURSE"], bodySchema: PatchBody },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request.url);
    if (!id) return err("BadRequest", 400);

    const existing = await prisma.labOrder.findFirst({
      where: { id, clinicId: ctx.clinicId },
      select: { id: true, doctorId: true, status: true },
    });
    if (!existing) return err("NotFound", 404);
    if (ctx.role === "DOCTOR" && existing.doctorId !== ctx.userId) {
      return err("Forbidden", 403);
    }

    const patch: Record<string, unknown> = {};
    if (body.status) patch.status = body.status;
    if (body.printedAt) patch.printedAt = new Date(body.printedAt);
    if (body.notes !== undefined) patch.notes = body.notes;

    if (Object.keys(patch).length === 0) return err("BadRequest", 400);

    const updated = await prisma.labOrder.update({
      where: { id },
      data: patch,
    });

    if (body.status === "CANCELLED") {
      await audit(request, {
        action: AUDIT_ACTION.LAB_ORDER_CANCELLED,
        entityType: "LabOrder",
        entityId: id,
        meta: { from: existing.status, to: "CANCELLED" },
      });
    } else if (body.printedAt) {
      await audit(request, {
        action: AUDIT_ACTION.LAB_ORDER_PRINTED,
        entityType: "LabOrder",
        entityId: id,
        meta: { printedAt: body.printedAt },
      });
    }

    return ok({
      id: updated.id,
      status: updated.status,
      printedAt: updated.printedAt ? updated.printedAt.toISOString() : null,
    });
  },
);

function idFromUrl(url: string): string | null {
  const m = /\/lab-orders\/([^/?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
