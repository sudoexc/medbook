/**
 * GET /api/crm/exports/[jobId] — poll job status.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { notFound, ok } from "@/server/http";
import { getExport } from "@/server/workers/exports";

function idFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  // .../api/crm/exports/<jobId>
  const idx = parts.findIndex((p) => p === "exports");
  if (idx < 0) return null;
  return parts[idx + 1] ?? null;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    if (!id) return notFound();
    const job = getExport(id);
    if (!job) return notFound();
    // Tenant isolation: ADMIN can only see their own clinic's jobs.
    if (
      ctx.kind === "TENANT" &&
      job.clinicId &&
      job.clinicId !== ctx.clinicId
    ) {
      return notFound();
    }
    return ok({
      id: job.id,
      kind: job.kind,
      status: job.status,
      rowCount: job.rowCount,
      fileSize: job.fileSize,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      downloadUrl: job.status === "done" ? `/api/crm/exports/${job.id}/download` : null,
    });
  },
);
