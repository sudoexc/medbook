/**
 * POST /api/crm/analytics/reports/run — Phase 18 Wave 3.
 *
 * Body: `{ config: ReportConfig, savedReportId?: string, name?: string }`.
 * Response: `{ rows, columns, generatedAt, rowCount, truncated }` JSON, OR a
 * CSV stream when `?format=csv` is set.
 *
 * Audit: every run lands an `ANALYTICS_REPORT_RUN` row. We log the saved id
 * when present so a forensic admin can answer "who ran what saved report".
 */
import { auth } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { prisma } from "@/lib/prisma";
import { runWithTenant, type TenantContext } from "@/lib/tenant-context";
import { csvFilename, formatCsv } from "@/server/analytics/csv";
import { formatReportPdf, pdfFilename } from "@/server/analytics/pdf";
import {
  ReportTimeoutError,
  runReport,
  type ReportRunnerClient,
} from "@/server/analytics/report-runner";
import {
  ReportConfigSchema,
  parseReportConfig,
} from "@/server/analytics/report-config";
import { err, ok } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);
  if (session.user.role !== "ADMIN") return err("Forbidden", 403);
  if (!session.user.clinicId) return err("ClinicNotSelected", 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }

  if (typeof body !== "object" || body === null) {
    return err("ValidationError", 400);
  }
  const wrapper = body as {
    config?: unknown;
    savedReportId?: unknown;
    name?: unknown;
  };
  let configData;
  try {
    configData = parseReportConfig(wrapper.config);
  } catch (e) {
    const issues = (e as { issues?: unknown }).issues;
    return err("ValidationError", 400, { issues });
  }

  const savedReportId =
    typeof wrapper.savedReportId === "string" ? wrapper.savedReportId : null;
  const reportName = typeof wrapper.name === "string" ? wrapper.name : null;

  const url = new URL(request.url);
  const formatParam = url.searchParams.get("format");
  const wantsCsv = formatParam === "csv";
  const wantsPdf = formatParam === "pdf";

  const ctx: TenantContext = {
    kind: "TENANT",
    clinicId: session.user.clinicId,
    userId: session.user.id,
    role: session.user.role,
  };

  try {
    const result = await runWithTenant(ctx, () =>
      runReport(
        prisma as unknown as ReportRunnerClient,
        ctx.clinicId as string,
        configData,
      ),
    );

    await audit(request, {
      action: AUDIT_ACTION.ANALYTICS_REPORT_RUN,
      entityType: savedReportId ? "SavedReport" : "AnalyticsView",
      entityId: savedReportId,
      meta: {
        savedReportId,
        dimensions: configData.dimensions,
        measures: configData.measures,
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
      const filename = csvFilename(reportName ?? "report");
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
        reportName: reportName ?? "Отчёт",
        generatedAt: new Date(result.generatedAt),
        columns: result.columns,
        rows: result.rows,
        filters: {
          dateFrom: configData.filters?.dateFrom ?? null,
          dateTo: configData.filters?.dateTo ?? null,
          statuses: configData.filters?.status as string[] | undefined,
        },
      });
      const filename = pdfFilename(reportName ?? "report");
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
      rows: serialiseRows(result.rows),
      columns: result.columns,
      rowCount: result.rowCount,
      truncated: result.truncated,
      generatedAt: result.generatedAt,
    });
  } catch (e) {
    if (e instanceof ReportTimeoutError) {
      return err("ReportTimeout", 504, {
        message: "Report exceeded 30s — narrow filters or reduce dimensions.",
      });
    }
    console.error("[reports/run]", e);
    return err("ReportRunFailed", 500);
  }
}

/** BigInt → string for JSON. The aggregator returns counts/tiins as bigint. */
function serialiseRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "bigint") out[k] = v.toString();
      else if (v instanceof Date) out[k] = v.toISOString();
      else out[k] = v;
    }
    return out;
  });
}

/** Re-export for the tests / contract checks. */
export const __schema = ReportConfigSchema;
