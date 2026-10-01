/**
 * /api/crm/patients/export — streaming CSV export. See docs/TZ.md §6.4.
 * ADMIN only. UTF-8 BOM, comma-separated, RFC 4180 quoting.
 *
 * Same file as the export worker (`src/server/exports/tables.ts`, audit
 * PT-19 / INF-02): the list's own filters, formula-safe cells, money in
 * сум, keyset paging, no DSAR-erased cards. A download of the patient base
 * is a bulk read of personal data, so it leaves one audit row with the
 * filters and the row count (audit G1-06).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { clientIpForAudit } from "@/lib/client-ip";
import { parseQuery } from "@/server/http";
import { QueryPatientSchema } from "@/server/schemas/patient";
import { writePatientsCsv } from "@/server/exports/tables";
import { runWithTenant } from "@/lib/tenant-context";

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryPatientSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const filters = {
      q: q.q,
      segment: q.segment,
      source: q.source,
      gender: q.gender,
      tag: q.tag,
      consent: q.consent,
      balance: q.balance,
      registeredFrom: q.registeredFrom,
      registeredTo: q.registeredTo,
      visitedFrom: q.visitedFrom,
      visitedTo: q.visitedTo,
    };

    const encoder = new TextEncoder();
    const BOM = "﻿";

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(BOM));
        // The stream body may run after the handler returned: keep the
        // tenant scope for its queries.
        const rowCount = await runWithTenant(ctx, () =>
          writePatientsCsv(filters, clinicId, (chunk) =>
            controller.enqueue(encoder.encode(chunk)),
          ),
        );
        controller.close();
        try {
          await prisma.auditLog.create({
            data: {
              clinicId,
              actorId: ctx.kind === "TENANT" ? ctx.userId : null,
              actorRole: ctx.kind === "TENANT" ? ctx.role : null,
              action: AUDIT_ACTION.CRM_EXPORT_COMPLETED,
              entityType: "ExportJob",
              entityId: null,
              meta: { kind: "patients", filters, rowCount, via: "stream" } as never,
              ip: clientIpForAudit(request),
              userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
            },
          });
        } catch (e) {
          console.error("[patients/export] audit failed", e);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="patients.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }
);
