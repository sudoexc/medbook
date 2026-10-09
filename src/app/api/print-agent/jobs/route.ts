/**
 * GET /api/print-agent/jobs — the print agent asks for its next ticket
 * (long poll, up to ~20 s). Answers `{ id, host, port, data }` (ESC/POS,
 * base64) after claiming the job, or 204. Token in `Authorization: Bearer`.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { JOB_STALE_MS, agentFromRequest } from "@/server/print/agent";

export const dynamic = "force-dynamic";

const WAIT_MS = 20_000;
const STEP_MS = 700;

export async function GET(request: Request) {
  const agent = await agentFromRequest(request);
  if (!agent) return Response.json({ error: "Unauthorized" }, { status: 401 });

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const touch = () =>
      prisma.printAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    await touch();
    // A ticket nobody took in time is not printed late.
    await prisma.printJob.updateMany({
      where: { agentId: agent.id, status: "QUEUED", createdAt: { lt: new Date(Date.now() - JOB_STALE_MS) } },
      data: { status: "FAILED", error: "expired" },
    });

    const until = Date.now() + WAIT_MS;
    while (Date.now() < until && !request.signal.aborted) {
      const job = await prisma.printJob.findFirst({
        where: { agentId: agent.id, status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        select: { id: true, data: true },
      });
      if (job) {
        const claimed = await prisma.printJob.updateMany({
          where: { id: job.id, status: "QUEUED" },
          data: { status: "SENT", sentAt: new Date() },
        });
        if (claimed.count === 1) {
          await touch();
          return Response.json({ id: job.id, host: agent.printerHost, port: agent.printerPort, data: job.data });
        }
      }
      await new Promise((r) => setTimeout(r, STEP_MS));
    }
    await touch();
    return new Response(null, { status: 204 });
  });
}
