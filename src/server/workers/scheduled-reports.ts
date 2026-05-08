/**
 * Phase 18 Wave 4 — scheduled-report delivery worker.
 *
 * Polling cadence: every 5 minutes. Each tick picks up to `BATCH_CAP`
 * `ScheduledReport` rows where `enabled = true AND nextRunAt <= now()`,
 * walks through them sequentially, and either delivers or fails-and-advances.
 *
 * Failure semantics
 * -----------------
 * On a delivery error we still advance `nextRunAt` to the next cadence step.
 * Otherwise a permanent failure (bad email, deleted TG chat, malformed
 * report config) would re-fire every 5 minutes forever. We track
 * `consecutiveFailures` separately; after 3 in a row the worker
 * auto-disables the schedule and emits `SCHEDULED_REPORT_DISABLED_AFTER_FAILURES`.
 *
 * Per-row timeout
 * ---------------
 * Each schedule has a 60s wall-clock budget (reportRun + render + delivery).
 * One heavy report cannot starve the rest of the batch. The Promise.race
 * pattern doesn't actually cancel the underlying I/O — it just unblocks
 * the worker; pending DB / SMTP calls run to completion in the background.
 *
 * Idempotency
 * -----------
 * Workers run in a single Node process today. If two processes ever boot,
 * both pickers race on the same row and both deliveries land — the only
 * harm is a duplicate email. We accept that for now (revisit when BullMQ
 * lands).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";

import {
  computeNextRunAt,
  type ScheduleCadence,
} from "@/server/analytics/cadence";
import { csvFilename, formatCsv } from "@/server/analytics/csv";
import {
  deliverScheduledReport,
  type DeliveryResult,
} from "@/server/analytics/delivery";
import { formatReportPdf, pdfFilename } from "@/server/analytics/pdf";
import {
  parseReportConfig,
  type ReportConfig,
} from "@/server/analytics/report-config";
import {
  runReport,
  type ReportRunnerClient,
} from "@/server/analytics/report-runner";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "analytics:scheduled-reports";
export const JOB_NAME = "tick";
const FIVE_MIN_MS = 5 * 60 * 1000;
const BATCH_CAP = 100;
const PER_ROW_TIMEOUT_MS = 60_000;
const FAILURE_THRESHOLD = 3;
const DEFAULT_TZ = "Asia/Tashkent";

// Maximum length we persist for `lastFailureReason` so the textarea in the
// CRM list view stays renderable. The full error is still in the worker log.
const FAILURE_REASON_MAX = 1000;

function clampReason(s: string): string {
  return s.length > FAILURE_REASON_MAX ? s.slice(0, FAILURE_REASON_MAX) : s;
}

interface ScheduleRow {
  id: string;
  clinicId: string;
  savedReportId: string;
  cadence: ScheduleCadence;
  nextRunAt: Date;
  deliveryChannel: "EMAIL" | "TELEGRAM";
  deliveryTarget: string;
  format: string;
  consecutiveFailures: number;
  enabled: boolean;
}

export interface RunnerDeps {
  /** Override for tests — defaults to the live `prisma` runner. */
  reportRunnerClient?: ReportRunnerClient;
  /** Override delivery for tests. */
  deliver?: typeof deliverScheduledReport;
  /** "Now" for deterministic testing. */
  now?: () => Date;
  /** Per-row timeout (defaults to 60s). */
  timeoutMs?: number;
  /** Override clinic timezone resolver. */
  resolveTimezone?: (clinicId: string) => Promise<string>;
}

async function defaultResolveTimezone(_clinicId: string): Promise<string> {
  // All clinics live in Asia/Tashkent today — Phase 19 will introduce per-
  // clinic locale + timezone settings; until then the default is fine.
  return DEFAULT_TZ;
}

async function fetchDueSchedules(
  now: Date,
  cap: number,
): Promise<ScheduleRow[]> {
  const rows = await prisma.scheduledReport.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: cap,
    select: {
      id: true,
      clinicId: true,
      savedReportId: true,
      cadence: true,
      nextRunAt: true,
      deliveryChannel: true,
      deliveryTarget: true,
      format: true,
      consecutiveFailures: true,
      enabled: true,
    },
  });
  return rows as unknown as ScheduleRow[];
}

async function logAudit(
  clinicId: string,
  action: string,
  entityId: string,
  meta: unknown,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId,
        action,
        entityType: "ScheduledReport",
        entityId,
        meta: meta as never,
        actorId: null,
        actorRole: null,
        actorLabel: "system",
      },
    });
  } catch (e) {
    console.error("[scheduled-reports] audit insert failed", e);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    if (typeof (t as { unref?: () => void }).unref === "function") {
      (t as { unref?: () => void }).unref?.();
    }
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

interface ProcessedSchedule {
  scheduleId: string;
  ok: boolean;
  error?: string;
  disabled?: boolean;
}

/**
 * Process a single schedule end-to-end. Pure-ish: calls Prisma + delivery
 * but returns a structured report so the tick loop can aggregate counts.
 */
export async function processSchedule(
  row: ScheduleRow,
  deps: RunnerDeps = {},
): Promise<ProcessedSchedule> {
  const now = deps.now ? deps.now() : new Date();
  const reportClient = deps.reportRunnerClient ?? (prisma as unknown as ReportRunnerClient);
  const deliver = deps.deliver ?? deliverScheduledReport;
  const resolveTz = deps.resolveTimezone ?? defaultResolveTimezone;
  const timeoutMs = deps.timeoutMs ?? PER_ROW_TIMEOUT_MS;
  const tz = await resolveTz(row.clinicId);

  const advance = (from: Date) => computeNextRunAt(row.cadence, from, tz);

  try {
    const result = await withTimeout(
      runWithTenant(
        {
          kind: "TENANT",
          clinicId: row.clinicId,
          userId: "system",
          role: "ADMIN",
        },
        async () => {
          const saved = await prisma.savedReport.findFirst({
            where: { id: row.savedReportId },
            select: {
              id: true,
              name: true,
              description: true,
              config: true,
              clinic: { select: { nameRu: true, nameUz: true } },
            },
          });
          if (!saved) {
            throw new Error("SavedReport not found");
          }
          let config: ReportConfig;
          try {
            config = parseReportConfig(saved.config);
          } catch {
            throw new Error("Saved report config is invalid");
          }
          const reportResult = await runReport(reportClient, row.clinicId, config);

          // Build attachment based on `format`.
          const filename =
            row.format === "csv"
              ? csvFilename(saved.name, now)
              : pdfFilename(saved.name, now);
          let body: Buffer;
          let contentType: string;
          if (row.format === "csv") {
            const csv = formatCsv(
              reportResult.columns.map((c) => ({
                key: c.key,
                label: c.label,
                unit: c.unit,
              })),
              reportResult.rows,
            );
            body = Buffer.from(csv, "utf8");
            contentType = "text/csv; charset=utf-8";
          } else {
            const pdfBuf = await formatReportPdf({
              clinicName: saved.clinic?.nameRu ?? saved.clinic?.nameUz ?? "NeuroFax",
              reportName: saved.name,
              description: saved.description ?? null,
              generatedAt: now,
              columns: reportResult.columns,
              rows: reportResult.rows,
              filters: {
                dateFrom: config.filters?.dateFrom ?? null,
                dateTo: config.filters?.dateTo ?? null,
                statuses: config.filters?.status as string[] | undefined,
              },
            });
            body = pdfBuf;
            contentType = "application/pdf";
          }

          // Filter summary appears in email subject + TG caption.
          const summaryParts: string[] = [];
          if (config.filters?.dateFrom || config.filters?.dateTo) {
            summaryParts.push(
              `Период: ${config.filters?.dateFrom ?? "—"} → ${config.filters?.dateTo ?? "—"}`,
            );
          }
          summaryParts.push(`Строк: ${reportResult.rowCount}`);
          if (reportResult.truncated) summaryParts.push("(данные обрезаны)");
          const summary = summaryParts.join("\n");

          const subject = `${saved.name} — отчёт за ${(config.filters?.dateFrom ?? "—").slice(0, 10)}…${(config.filters?.dateTo ?? "—").slice(0, 10)}`;

          const delivery: DeliveryResult = await deliver({
            channel: row.deliveryChannel,
            clinicId: row.clinicId,
            payload: {
              filename,
              contentType,
              body,
              recipient: row.deliveryTarget,
              subject,
              summary,
            },
          });
          if (!delivery.ok) {
            throw new Error(delivery.error ?? "delivery_failed");
          }
          return {
            saved,
            rowCount: reportResult.rowCount,
            truncated: reportResult.truncated,
            simulated: delivery.simulated === true,
          };
        },
      ),
      timeoutMs,
      `scheduled-report ${row.id}`,
    );

    const newNext = advance(now);
    await prisma.scheduledReport.update({
      where: { id: row.id },
      data: {
        lastDeliveredAt: now,
        nextRunAt: newNext,
        lastFailureReason: null,
        consecutiveFailures: 0,
      },
    });
    await logAudit(
      row.clinicId,
      AUDIT_ACTION.SCHEDULED_REPORT_DELIVERED,
      row.id,
      {
        savedReportId: row.savedReportId,
        format: row.format,
        rowCount: result.rowCount,
        truncated: result.truncated,
        channel: row.deliveryChannel,
        simulated: result.simulated,
      },
    );
    return { scheduleId: row.id, ok: true };
  } catch (err) {
    const reason = clampReason((err as Error).message ?? String(err));
    const nextFailures = row.consecutiveFailures + 1;
    const shouldDisable = nextFailures >= FAILURE_THRESHOLD;
    // Why advance nextRunAt even on failure: a permanent error (deleted
    // chat, dead email) would otherwise re-fire every poll until disabled.
    const newNext = advance(now);
    await prisma.scheduledReport.update({
      where: { id: row.id },
      data: {
        nextRunAt: newNext,
        lastFailureReason: reason,
        consecutiveFailures: nextFailures,
        ...(shouldDisable ? { enabled: false } : {}),
      },
    });
    await logAudit(
      row.clinicId,
      AUDIT_ACTION.SCHEDULED_REPORT_FAILED,
      row.id,
      {
        savedReportId: row.savedReportId,
        consecutiveFailures: nextFailures,
        reason,
      },
    );
    if (shouldDisable) {
      await logAudit(
        row.clinicId,
        AUDIT_ACTION.SCHEDULED_REPORT_DISABLED_AFTER_FAILURES,
        row.id,
        {
          savedReportId: row.savedReportId,
          consecutiveFailures: nextFailures,
          lastFailureReason: reason,
        },
      );
      return { scheduleId: row.id, ok: false, error: reason, disabled: true };
    }
    return { scheduleId: row.id, ok: false, error: reason };
  }
}

export interface TickResult {
  picked: number;
  delivered: number;
  failed: number;
  disabled: number;
}

/**
 * One picker-loop iteration. Exported for tests so they can fast-forward
 * through several ticks deterministically.
 */
export async function runScheduledReportsTick(
  deps: RunnerDeps = {},
): Promise<TickResult> {
  const now = deps.now ? deps.now() : new Date();
  const rows = await fetchDueSchedules(now, BATCH_CAP);
  let delivered = 0;
  let failed = 0;
  let disabled = 0;
  for (const row of rows) {
    try {
      const r = await processSchedule(row, deps);
      if (r.ok) delivered += 1;
      else failed += 1;
      if (r.disabled) disabled += 1;
    } catch (e) {
      // processSchedule already swallows internal errors via the catch above.
      // This outermost catch is only here so a surprise throw (e.g. from the
      // audit insert path itself) cannot kill the worker.
      console.error("[scheduled-reports] unexpected error", e);
      failed += 1;
    }
  }
  if (rows.length > 0) {
    console.info(
      `[scheduled-reports] tick: ${delivered} delivered, ${failed} failed (${disabled} auto-disabled), ${rows.length} picked`,
    );
  }
  return { picked: rows.length, delivered, failed, disabled };
}

export function startScheduledReportsWorker(
  intervalMs: number = FIVE_MIN_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<{ tick: true }>(QUEUE_NAME, JOB_NAME, async () => {
    await runScheduledReportsTick();
  });
  const handle = queue.repeat<{ tick: true }>(
    QUEUE_NAME,
    JOB_NAME,
    { tick: true },
    intervalMs,
  );
  console.info("[worker] analytics:scheduled-reports registered (5min)");
  return handle;
}
