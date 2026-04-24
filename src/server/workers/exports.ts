/**
 * CSV export worker (Phase 5). Replaces the Phase 2 synchronous streaming
 * endpoints for large datasets. Flow:
 *
 *   UI → POST /api/crm/exports   → { jobId }
 *   UI → GET  /api/crm/exports/:id (poll)
 *   UI → GET  /api/crm/exports/:id/download (stream file)
 *
 * Backing store:
 *   - Queue: `getQueue()` (`InMemoryQueueAdapter` today, BullMQ in Phase 6).
 *   - Registry: in-memory `Map<jobId, ExportJob>`. Loses state on restart —
 *     acceptable for dev; Phase 6 persists in Postgres + MinIO.
 *   - File: `/tmp/exports/<jobId>.csv` — Phase 6 rewrites to MinIO object.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { TenantContext } from "@/lib/tenant-context";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { enqueue, getQueue } from "@/server/queue";

export type ExportKind = "patients" | "appointments" | "payments";

export type ExportStatus = "pending" | "running" | "done" | "failed";

export interface ExportFilters {
  // Free-form filter pass-through per kind. Keep it conservative — the
  // worker just maps known keys to Prisma `where`.
  q?: string;
  segment?: string;
  gender?: string;
  source?: string;
  tag?: string;
  doctorId?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  paidOnly?: boolean;
}

export interface ExportJob {
  id: string;
  kind: ExportKind;
  filters: ExportFilters;
  status: ExportStatus;
  requestedBy: string | null;
  clinicId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  rowCount: number;
  filePath: string | null;
  fileSize: number | null;
  error: string | null;
}

const EXPORT_QUEUE = "exports";
const EXPORT_JOB = "run";
const EXPORT_DIR = path.join("/tmp", "exports");

// In-memory registry. Phase 6 will persist in Postgres.
const registry = new Map<string, ExportJob>();

/** Test-only: reset the registry between tests. */
export function __resetExportRegistry() {
  registry.clear();
}

/** Look up a job by id. Returns null if unknown. */
export function getExport(jobId: string): ExportJob | null {
  return registry.get(jobId) ?? null;
}

function ensureDir(dir: string): Promise<void> {
  return fs.mkdir(dir, { recursive: true }).then(() => undefined);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s =
    value instanceof Date
      ? value.toISOString()
      : Array.isArray(value)
        ? value.join("|")
        : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Per-kind CSV producers
// ---------------------------------------------------------------------------

const PATIENT_COLS = [
  "id",
  "fullName",
  "phone",
  "gender",
  "birthDate",
  "segment",
  "source",
  "ltv",
  "visitsCount",
  "balance",
  "lastVisitAt",
  "tags",
  "createdAt",
] as const;

const APPOINTMENT_COLS = [
  "id",
  "date",
  "status",
  "doctorId",
  "patientId",
  "serviceId",
  "channel",
  "priceFinal",
  "createdAt",
] as const;

const PAYMENT_COLS = [
  "id",
  "appointmentId",
  "patientId",
  "amount",
  "currency",
  "method",
  "status",
  "paidAt",
  "createdAt",
] as const;

function headerLine(cols: readonly string[]): string {
  return cols.join(",") + "\n";
}

function rowLine(row: Record<string, unknown>, cols: readonly string[]): string {
  return cols.map((c) => csvEscape(row[c])).join(",") + "\n";
}

async function exportPatients(
  filters: ExportFilters,
  writer: (chunk: string) => void,
): Promise<number> {
  const where: Record<string, unknown> = {};
  if (filters.segment) where.segment = filters.segment;
  if (filters.gender) where.gender = filters.gender;
  if (filters.source) where.source = filters.source;
  if (filters.tag) where.tags = { has: filters.tag };

  writer(headerLine(PATIENT_COLS));
  let count = 0;
  let cursor: string | undefined;
  const PAGE = 500;
  while (true) {
    const batch = await prisma.patient.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      writer(rowLine(row as unknown as Record<string, unknown>, PATIENT_COLS));
      count += 1;
    }
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < PAGE) break;
  }
  return count;
}

async function exportAppointments(
  filters: ExportFilters,
  writer: (chunk: string) => void,
): Promise<number> {
  const where: Record<string, unknown> = {};
  if (filters.doctorId) where.doctorId = filters.doctorId;
  if (filters.status) where.status = filters.status;
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.gte = new Date(filters.dateFrom);
    if (filters.dateTo) range.lte = new Date(filters.dateTo);
    where.date = range;
  }

  writer(headerLine(APPOINTMENT_COLS));
  let count = 0;
  let cursor: string | undefined;
  const PAGE = 500;
  while (true) {
    const batch = await prisma.appointment.findMany({
      where,
      orderBy: { date: "desc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      writer(
        rowLine(row as unknown as Record<string, unknown>, APPOINTMENT_COLS),
      );
      count += 1;
    }
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < PAGE) break;
  }
  return count;
}

async function exportPayments(
  filters: ExportFilters,
  writer: (chunk: string) => void,
): Promise<number> {
  const where: Record<string, unknown> = {};
  if (filters.paidOnly) where.status = "PAID";
  if (filters.dateFrom || filters.dateTo) {
    const range: Record<string, Date> = {};
    if (filters.dateFrom) range.gte = new Date(filters.dateFrom);
    if (filters.dateTo) range.lte = new Date(filters.dateTo);
    where.paidAt = range;
  }

  writer(headerLine(PAYMENT_COLS));
  let count = 0;
  let cursor: string | undefined;
  const PAGE = 500;
  while (true) {
    const batch = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (batch.length === 0) break;
    for (const row of batch) {
      writer(rowLine(row as unknown as Record<string, unknown>, PAYMENT_COLS));
      count += 1;
    }
    cursor = batch[batch.length - 1]?.id;
    if (batch.length < PAGE) break;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Worker body — invoked by the queue adapter when an enqueued job fires.
// ---------------------------------------------------------------------------

interface ExportJobPayload {
  jobId: string;
  tenant: TenantContext;
}

async function runExportJob(payload: ExportJobPayload): Promise<void> {
  const job = registry.get(payload.jobId);
  if (!job) return;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await ensureDir(EXPORT_DIR);
  const filePath = path.join(EXPORT_DIR, `${job.id}.csv`);
  const BOM = "﻿";
  const parts: string[] = [BOM];
  const writer = (chunk: string) => parts.push(chunk);

  try {
    const count = await runWithTenant(payload.tenant, async () => {
      switch (job.kind) {
        case "patients":
          return exportPatients(job.filters, writer);
        case "appointments":
          return exportAppointments(job.filters, writer);
        case "payments":
          return exportPayments(job.filters, writer);
        default:
          throw new Error(`unknown kind: ${job.kind as string}`);
      }
    });
    const body = parts.join("");
    await fs.writeFile(filePath, body, "utf8");
    const stat = await fs.stat(filePath);
    job.rowCount = count;
    job.filePath = filePath;
    job.fileSize = stat.size;
    job.status = "done";
    job.finishedAt = new Date().toISOString();
  } catch (e) {
    job.status = "failed";
    job.error = (e as Error).message ?? String(e);
    job.finishedAt = new Date().toISOString();
  }
}

/** Register the worker lazily on first enqueue. */
let workerRegistered = false;
function ensureWorker() {
  if (workerRegistered) return;
  getQueue().registerWorker<ExportJobPayload>(
    EXPORT_QUEUE,
    EXPORT_JOB,
    runExportJob,
  );
  workerRegistered = true;
}

/**
 * Enqueue a new export. Returns the job id immediately; the caller polls
 * via `getExport(jobId)`.
 */
export async function enqueueExport(args: {
  kind: ExportKind;
  filters: ExportFilters;
  requestedBy: string | null;
  clinicId: string | null;
  tenant: TenantContext;
}): Promise<ExportJob> {
  ensureWorker();
  const id = crypto.randomBytes(12).toString("hex");
  const job: ExportJob = {
    id,
    kind: args.kind,
    filters: args.filters,
    status: "pending",
    requestedBy: args.requestedBy,
    clinicId: args.clinicId,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    rowCount: 0,
    filePath: null,
    fileSize: null,
    error: null,
  };
  registry.set(id, job);
  await enqueue<ExportJobPayload>(EXPORT_QUEUE, EXPORT_JOB, {
    jobId: id,
    tenant: args.tenant,
  });
  return job;
}

/** Test-only: run the export synchronously (bypasses the queue). */
export async function __runExportForTests(
  jobId: string,
  tenant: TenantContext,
): Promise<ExportJob | null> {
  const job = registry.get(jobId);
  if (!job) return null;
  await runExportJob({ jobId, tenant });
  return registry.get(jobId) ?? null;
}
