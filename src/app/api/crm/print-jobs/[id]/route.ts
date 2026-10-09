/**
 * GET  /api/crm/print-jobs/[id] — `{ status, error }` of a ticket job.
 * POST /api/crm/print-jobs/[id] — take back a job the agent has not taken
 * yet (`{ cancelled }`), so the screen can print from the browser without
 * the ticket coming out twice.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";

const ROLES = ["RECEPTIONIST", "NURSE", "ADMIN", "SUPER_ADMIN", "DOCTOR"] as const;

function idFromUrl(request: Request): string {
  return decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "");
}

export const GET = createApiListHandler({ roles: [...ROLES] }, async ({ request, ctx }) => {
  if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
  const job = await prisma.printJob.findFirst({
    where: { id: idFromUrl(request) },
    select: { status: true, error: true },
  });
  return job ? ok(job) : notFound();
});

export const POST = createApiHandler({ roles: [...ROLES] }, async ({ request, ctx }) => {
  if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
  const done = await prisma.printJob.updateMany({
    where: { id: idFromUrl(request), status: "QUEUED" },
    data: { status: "CANCELLED" },
  });
  return ok({ cancelled: done.count === 1 });
});
