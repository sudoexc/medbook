/**
 * POST /api/crm/analytics/reports/[id]/run — run a saved report.
 *
 * Loads the SavedReport, re-validates its persisted `config` (defensive —
 * config is `Json` in the DB), executes via the same runner the transient
 * /reports/run endpoint uses, bumps `lastRunAt`, and audits the run with
 * the saved id in `meta`.
 *
 * Supports `?format=csv` like the transient runner.
 */
import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { csvFilename, formatCsv } from "@/server/analytics/csv";
import { formatReportPdf, pdfFilename } from "@/server/analytics/pdf";
import { parseReportConfig } from "@/server/analytics/report-config";
import {
  ReportTimeoutError,
  runReport,
  type ReportRunnerClient,
} from "@/server/analytics/report-runner";
import { err, notFound, ok } from "@/server/http";

export const runtime = "nodejs";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /.../reports/[id]/run
  return parts[parts.length - 2] ?? "";
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  const id = idFromUrl(request);
  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  const url = new URL(request.url);
  const formatParam = url.searchParams.get("format");
  const wantsCsv = formatParam === "csv";
  const wantsPdf = formatParam === "pdf";

  try {
    return await runWithTenant(ctx, async () => {
      const saved = await prisma.savedReport.findFirst({
        where: { id },
        select: { id: true, name: true, config: true },
      });
      if (!saved) return notFound();

      let config;
      try {
        config = parseReportConfig(saved.config);
      } catch (e) {
        const issues = (e as { issues?: unknown }).issues;
        return err("StoredReportInvalid", 422, { issues });
      }

      const result = await runReport(
        prisma as unknown as ReportRunnerClient,
        ctx.clinicId as string,
        config,
      );

      // lastRunAt bump is a separate update so the run path is unaffected by
      // a slow write — the user already has the result in hand.
      await prisma.savedReport.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });

      await audit(request, {
        action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
        entityType: "SavedReport",
        entityId: id,
        meta: {
          savedReportId: id,
          name: saved.name,
          dimensions: config.dimensions,
          measures: config.measures,
          runMs: result.runMs,
          rowCount: result.rowCount,
        },
      });

      if (wantsCsv) {
        const csv = formatCsv(
          result.columns.map((c) => ({
            key: c.key,
            label: c.label,
            unit: c.unit,
          })),
          result.rows,
        );
        const filename = csvFilename(saved.name);
        return new Response(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
            "cache-control": "no-store",
          },
        });
      }

      if (wantsPdf) {
        const clinic = await prisma.clinic.findUnique({
          where: { id: ctx.clinicId as string },
          select: { nameRu: true, nameUz: true },
        });
        const pdfBuf = await formatReportPdf({
          clinicName: clinic?.nameRu ?? clinic?.nameUz ?? "NeuroFax",
          reportName: saved.name,
          generatedAt: new Date(result.generatedAt),
          columns: result.columns,
          rows: result.rows,
          filters: {
            dateFrom: config.filters?.dateFrom ?? null,
            dateTo: config.filters?.dateTo ?? null,
            statuses: config.filters?.status as string[] | undefined,
          },
        });
        const filename = pdfFilename(saved.name);
        return new Response(new Uint8Array(pdfBuf), {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": `attachment; filename="${filename}"`,
            "cache-control": "no-store",
          },
        });
      }

      return ok({
        rows: result.rows.map((row) => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(row)) {
            if (typeof v === "bigint") out[k] = v.toString();
            else if (v instanceof Date) out[k] = v.toISOString();
            else out[k] = v;
          }
          return out;
        }),
        columns: result.columns,
        rowCount: result.rowCount,
        truncated: result.truncated,
        generatedAt: result.generatedAt,
      });
    });
  } catch (e) {
    if (e instanceof ReportTimeoutError) {
      return err("ReportTimeout", 504, {
        message: "Report exceeded 30s — narrow filters or reduce dimensions.",
      });
    }
    console.error("[reports/[id]/run]", e);
    return err("ReportRunFailed", 500);
  }
}
