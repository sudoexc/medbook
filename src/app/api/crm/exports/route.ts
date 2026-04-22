/**
 * POST /api/crm/exports — enqueue a CSV export job.
 *
 * Body: { kind: 'patients'|'appointments'|'payments', filters }
 * Returns: { jobId }
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { enqueueExport } from "@/server/workers/exports";

const Schema = z.object({
  kind: z.enum(["patients", "appointments", "payments"]),
  filters: z
    .object({
      q: z.string().optional(),
      segment: z.string().optional(),
      gender: z.string().optional(),
      source: z.string().optional(),
      tag: z.string().optional(),
      doctorId: z.string().optional(),
      status: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      paidOnly: z.boolean().optional(),
    })
    .default({}),
});

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: Schema },
  async ({ body, ctx }) => {
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
    return ok({ jobId: job.id, status: job.status });
  },
);
