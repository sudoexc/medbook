/**
 * GET /api/crm/exports/[jobId]/download — stream the generated CSV.
 *
 * Phase 6 rewrites this to issue a short-lived MinIO presigned URL and
 * redirect; today it reads `/tmp/exports/<jobId>.csv` directly.
 */
import { promises as fs } from "node:fs";

import { createApiListHandler } from "@/lib/api-handler";
import { notFound } from "@/server/http";
import { getExport } from "@/server/workers/exports";

function idFromUrl(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
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
    const buf = await fs.readFile(job.filePath);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${job.kind}-${job.id}.csv"`,
      },
    });
  },
);
