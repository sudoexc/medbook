/**
 * POST /api/crm/exports — enqueue a CSV export job.
 *
 * Body: { kind: 'patients'|'appointments'|'payments', filters }
 * Returns: { jobId }
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok } from "@/server/http";
import { enqueueExport } from "@/server/workers/exports";
import { EXPORT_ROLES } from "@/lib/export-roles";
import { isTashkentDateString } from "@/lib/tashkent-time";
import { TashkentDaySchema } from "@/server/schemas/common";

/** A period bound: a Tashkent day or an ISO instant, nothing else. */
const PeriodBound = z
  .string()
  .refine((v) => isTashkentDateString(v) || !Number.isNaN(Date.parse(v)), {
    message: "expected YYYY-MM-DD or an ISO date-time",
  });

/**
 * The screen's filters (audit PT-19, INF-02). Dates are validated here: an
 * attribution marker that leaked into `from` (`?from=ai-rec`) used to reach
 * the worker as `new Date("ai-rec")` and fail the export.
 */
const Schema = z.object({
  kind: z.enum(["patients", "appointments", "payments"]),
  filters: z
    .object({
      q: z.string().max(200).optional(),
      segment: z.string().optional(),
      gender: z.string().optional(),
      source: z.string().optional(),
      tag: z.string().optional(),
      consent: z.enum(["yes", "no"]).optional(),
      balance: z.enum(["debt", "zero", "credit"]).optional(),
      registeredFrom: PeriodBound.optional(),
      registeredTo: PeriodBound.optional(),
      visitedFrom: TashkentDaySchema.optional(),
      visitedTo: TashkentDaySchema.optional(),
      ageMin: z.number().int().min(0).max(150).optional(),
      ageMax: z.number().int().min(0).max(150).optional(),
      doctorId: z.string().optional(),
      cabinetId: z.string().optional(),
      channel: z.string().optional(),
      serviceId: z.string().optional(),
      status: z.string().optional(),
      statuses: z.array(z.string()).max(10).optional(),
      unpaid: z.boolean().optional(),
      dateFrom: PeriodBound.optional(),
      dateTo: PeriodBound.optional(),
      paidOnly: z.boolean().optional(),
    })
    .default({}),
});

export const POST = createApiHandler(
  { roles: [...EXPORT_ROLES], bodySchema: Schema },
  async ({ request, body, ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const requestedBy =
      ctx.kind === "TENANT" || ctx.kind === "SUPER_ADMIN" ? ctx.userId : null;
    const job = await enqueueExport({
      kind: body.kind,
      filters: body.filters,
      requestedBy,
      clinicId,
      tenant: ctx,
    });
    await audit(request, {
      action: AUDIT_ACTION.CRM_EXPORT_REQUESTED,
      entityType: "ExportJob",
      entityId: job.id,
      meta: { kind: body.kind, filters: body.filters },
    });
    return ok({ jobId: job.id, status: job.status });
  },
);
