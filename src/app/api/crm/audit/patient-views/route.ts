/**
 * Phase 17 Wave 1 — GET /api/crm/audit/patient-views
 *
 * ADMIN-only listing of `PatientView` rows for the active clinic. Powers the
 * "PHI Access" tab on /crm/settings/audit.
 *
 * The act of pulling this list is itself audited
 * (`AUDIT_ACTION.PATIENT_VIEW_AUDIT_ACCESSED`) so an attacker who gains
 * ADMIN credentials cannot quietly browse PHI access history without leaving
 * a meta-trail.
 *
 * Filters: patientId, viewerUserId, from, to. Cursor-based pagination
 * (50 rows per page, capped at 200).
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { tashkentDayRange } from "@/lib/tashkent-time";
import { ok, parseQuery } from "@/server/http";
import { TashkentDaySchema } from "@/server/schemas/common";

const QuerySchema = z.object({
  patientId: z.string().optional(),
  viewerUserId: z.string().optional(),
  context: z.string().optional(),
  // Tashkent calendar days, both inclusive (audit ST-09).
  from: TashkentDaySchema.optional(),
  to: TashkentDaySchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QuerySchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    if (ctx.kind === "TENANT") where.clinicId = ctx.clinicId;
    if (q.patientId) where.patientId = q.patientId;
    if (q.viewerUserId) where.viewerUserId = q.viewerUserId;
    if (q.context) where.context = q.context;
    const createdAt = tashkentDayRange(q.from, q.to);
    if (createdAt) where.createdAt = createdAt;

    const take = q.limit + 1;
    const rows = await prisma.patientView.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      include: {
        viewer: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      const next = rows.pop();
      nextCursor = next?.id ?? null;
    }
    // `patientId` is a plain id since audit G1-09: the view rows outlive a
    // deleted card, so the patient is looked up, and a gone one reads null
    // (the table shows the id tail instead of a name).
    const patientIds = Array.from(new Set(rows.map((r) => r.patientId)));
    const patients =
      patientIds.length > 0
        ? await prisma.patient.findMany({
            where: { id: { in: patientIds } },
            select: { id: true, fullName: true, phone: true },
          })
        : [];
    const patientById = new Map(patients.map((p) => [p.id, p]));
    const withPatients = rows.map((r) => ({
      ...r,
      patient: patientById.get(r.patientId) ?? null,
    }));

    // Meta-audit: pulling the PHI-access log is itself sensitive.
    try {
      await audit(request, {
        action: AUDIT_ACTION.PATIENT_VIEW_AUDIT_ACCESSED,
        entityType: "PatientView",
        entityId: null,
        meta: {
          filters: {
            patientId: q.patientId ?? null,
            viewerUserId: q.viewerUserId ?? null,
            context: q.context ?? null,
            from: q.from ?? null,
            to: q.to ?? null,
          },
          rowCount: rows.length,
        },
      });
    } catch (e) {
      console.error("[audit:patient-views] meta-audit failed", e);
    }

    return ok({ rows: withPatients, nextCursor });
  },
);
