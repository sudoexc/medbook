/**
 * CSV export worker (Phase 5). Replaces the Phase 2 synchronous streaming
 * endpoints for large datasets. Flow:
 *
 *   UI → POST /api/crm/exports   → { jobId }
 *   UI → GET  /api/crm/exports/:id (poll)
 *   UI → GET  /api/crm/exports/:id/download (stream file)
 *
 * Backing store:
 *   - Queue: `getQueue()`.
 *   - Registry: in-memory `Map<jobId, ExportJob>`. Loses state on restart:
 *     the button then says the export was lost (audit AN-27) and the admin
 *     presses it again.
 *   - File: `/tmp/exports/<jobId>.csv`, readable by this process only.
 *     These files are lists of patients (PHI) and used to stay there for the
 *     life of the container (audit INF-02): a job and its file now expire
 *     an hour after they finish, and a sweep removes expired and orphaned
 *     files (left over from before a restart) on every new export and every
 *     ten minutes.
 *
 * What goes into the files lives in `src/server/exports/tables.ts`: the
 * list's own filters, keyset paging over a unique order, money in сум.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import type { TenantContext } from "@/lib/tenant-context";
import { runWithTenant } from "@/lib/tenant-context";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { enqueue, getQueue } from "@/server/queue";
import {
  writeAppointmentsCsv,
  writePatientsCsv,
  writePaymentsCsv,
} from "@/server/exports/tables";

export type ExportKind = "patients" | "appointments" | "payments";

export type ExportStatus = "pending" | "running" | "done" | "failed";

export interface ExportFilters {
  // The screen's filters, per kind. Unknown keys are ignored.
  q?: string;
  // Patients.
  segment?: string;
  gender?: string;
  source?: string;
  tag?: string;
  consent?: "yes" | "no";
  balance?: "debt" | "zero" | "credit";
  registeredFrom?: string;
  registeredTo?: string;
  visitedFrom?: string;
  visitedTo?: string;
  ageMin?: number;
  ageMax?: number;
  // Appointments.
  doctorId?: string;
  cabinetId?: string;
  channel?: string;
  status?: string;
  statuses?: string[];
  unpaid?: boolean;
  // Appointments and payments.
  dateFrom?: string;
  dateTo?: string;
  // Payments.
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
/** A finished job and its file live this long, then both are removed. */
export const EXPORT_TTL_MS = 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

// In-memory registry.
const registry = new Map<string, ExportJob>();

/** Test-only: reset the registry between tests. */
export function __resetExportRegistry() {
  registry.clear();
}

/** Has this job's time run out (an hour after it finished)? */
function isExpired(job: ExportJob, now: number): boolean {
  if (!job.finishedAt) return false;
  return now - Date.parse(job.finishedAt) > EXPORT_TTL_MS;
}

/** Look up a job by id. Returns null if unknown or expired. */
export function getExport(jobId: string): ExportJob | null {
  const job = registry.get(jobId) ?? null;
  if (job && isExpired(job, Date.now())) return null;
  return job;
}

function ensureDir(dir: string): Promise<void> {
  // Owner-only: the files are lists of patients.
  return fs.mkdir(dir, { recursive: true, mode: 0o700 }).then(() => undefined);
}

/**
 * Remove expired jobs with their files, and any file in the export folder
 * older than the TTL that no live job owns (a restart forgets the registry,
 * not the disk). Returns how many files were removed. Never throws.
 */
export async function sweepExpiredExports(now: number = Date.now()): Promise<number> {
  let removed = 0;
  const owned = new Set<string>();
  for (const [id, job] of registry) {
    if (isExpired(job, now)) {
      registry.delete(id);
      if (job.filePath) {
        await fs.unlink(job.filePath).then(
          () => void removed++,
          () => undefined,
        );
      }
    } else if (job.filePath) {
      owned.add(path.resolve(job.filePath));
    }
  }
  let names: string[] = [];
  try {
    names = await fs.readdir(EXPORT_DIR);
  } catch {
    return removed;
  }
  for (const name of names) {
    const full = path.resolve(EXPORT_DIR, name);
    if (owned.has(full)) continue;
    try {
      const st = await fs.stat(full);
      if (now - st.mtimeMs > EXPORT_TTL_MS) {
        await fs.unlink(full);
        removed++;
      }
    } catch {
      // Raced with another sweep or never ours: nothing to do.
    }
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Worker body — invoked by the queue adapter when an enqueued job fires.
// ---------------------------------------------------------------------------

interface ExportJobPayload {
  jobId: string;
  tenant: TenantContext;
}

/**
 * The file is a bulk read of patient data: one audit row with what it
 * held (audit G1-06). Never fails the export.
 */
async function auditCompleted(job: ExportJob, tenant: TenantContext): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: job.clinicId,
        actorId: tenant.kind === "TENANT" ? tenant.userId : null,
        actorRole: tenant.kind === "TENANT" ? tenant.role : null,
        action: AUDIT_ACTION.CRM_EXPORT_COMPLETED,
        entityType: "ExportJob",
        entityId: job.id,
        meta: {
          kind: job.kind,
          filters: job.filters,
          rowCount: job.rowCount,
          via: "worker",
        } as never,
      },
    });
  } catch (e) {
    console.error("[exports] completion audit failed", e);
  }
}

async function runExportJob(payload: ExportJobPayload): Promise<void> {
  const job = registry.get(payload.jobId);
  if (!job) return;
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await ensureDir(EXPORT_DIR);
  const filePath = path.join(EXPORT_DIR, `${job.id}.csv`);
  const BOM = "\uFEFF";
  const parts: string[] = [BOM];
  const writer = (chunk: string) => parts.push(chunk);

  try {
    const count = await runWithTenant(payload.tenant, async () => {
      switch (job.kind) {
        case "patients":
          return writePatientsCsv(job.filters, job.clinicId, writer);
        case "appointments":
          return writeAppointmentsCsv(job.filters, writer);
        case "payments":
          return writePaymentsCsv(job.filters, writer);
        default:
          throw new Error(`unknown kind: ${job.kind as string}`);
      }
    });
    const body = parts.join("");
    await fs.writeFile(filePath, body, { encoding: "utf8", mode: 0o600 });
    const stat = await fs.stat(filePath);
    job.rowCount = count;
    job.filePath = filePath;
    job.fileSize = stat.size;
    job.status = "done";
    job.finishedAt = new Date().toISOString();
    await auditCompleted(job, payload.tenant);
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
  // Expired files go even when nobody exports for a while.
  const timer = setInterval(() => void sweepExpiredExports(), SWEEP_EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
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
  await sweepExpiredExports();
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
