/**
 * POST /api/print-agent/jobs/[id] — the agent reports `{ ok, error? }` for
 * a job it took: DONE, or FAILED with the printer's error (the CRM then
 * prints from the browser instead).
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { agentFromRequest } from "@/server/print/agent";

const ResultSchema = z.object({ ok: z.boolean(), error: z.string().max(500).nullish() });

export async function POST(request: Request) {
  const agent = await agentFromRequest(request);
  if (!agent) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = decodeURIComponent(new URL(request.url).pathname.split("/").filter(Boolean).pop() ?? "");
  const parsed = ResultSchema.safeParse(await request.json().catch(() => null));
  if (!id || !parsed.success) return Response.json({ error: "BadRequest" }, { status: 400 });
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.printJob.updateMany({
      where: { id, agentId: agent.id, status: "SENT" },
      data: parsed.data.ok
        ? { status: "DONE", doneAt: new Date() }
        : { status: "FAILED", error: parsed.data.error ?? "printer_error", doneAt: new Date() },
    }),
  );
  return Response.json({ ok: true });
}
