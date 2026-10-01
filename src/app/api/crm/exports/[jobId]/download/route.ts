/**
 * GET /api/crm/exports/[jobId]/download — stream the generated CSV.
 *
 * Reads `/tmp/exports/<jobId>.csv`; the job and its file expire an hour
 * after the export finished (audit INF-02), then this answers 404.
 */
import { promises as fs } from "node:fs";

import { createApiListHandler } from "@/lib/api-handler";
import { notFound } from "@/server/http";
import { getExport } from "@/server/workers/exports";
import { EXPORT_ROLES } from "@/lib/export-roles";

function idFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "exports");
  if (idx < 0) return null;
  return parts[idx + 1] ?? null;
}

export const GET = createApiListHandler(
  { roles: [...EXPORT_ROLES] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    if (!id) return notFound();
    const job = getExport(id);
    if (!job) return notFound();
    if (
      ctx.kind === "TENANT" &&
      job.clinicId &&
      job.clinicId !== ctx.clinicId
    ) {
      return notFound();
    }
    if (job.status !== "done" || !job.filePath) {
      return new Response(
        JSON.stringify({ error: "NotReady", status: job.status }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(job.filePath);
    } catch {
      // Swept (an hour after it finished) or lost with the container.
      return notFound();
    }
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${job.kind}-${job.id}.csv"`,
        // A list of patients: never kept by a browser or proxy cache.
        "Cache-Control": "private, no-store",
      },
    });
  },
);
