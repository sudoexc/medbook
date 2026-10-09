/**
 * POST /api/crm/print-jobs — `{ appointmentId }`: print the ticket on the
 * clinic's network receipt printer through its print agent (owner request
 * 09.10.2026). `{ queued: false }` when no agent is running: the screen
 * then prints from the browser as before.
 */
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, notFound, ok } from "@/server/http";
import { onlineAgentOf } from "@/server/print/agent";
import { loadTicketSlip, renderTicketEscPos } from "@/server/print/ticket";

const PrintJobSchema = z.object({ appointmentId: z.string().min(1).max(64) });

export const POST = createApiHandler<z.infer<typeof PrintJobSchema>>(
  {
    roles: ["RECEPTIONIST", "NURSE", "ADMIN", "SUPER_ADMIN", "DOCTOR"],
    bodySchema: PrintJobSchema,
  },
  async ({ body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("ClinicNotSelected", 400);
    const agent = await onlineAgentOf(ctx.clinicId);
    if (!agent) return ok({ queued: false });
    const slip = await loadTicketSlip(body.appointmentId, ctx.clinicId);
    if (!slip) return notFound();
    const job = await prisma.printJob.create({
      data: {
        clinicId: ctx.clinicId,
        agentId: agent.id,
        appointmentId: body.appointmentId,
        data: renderTicketEscPos(slip, agent.codePage).toString("base64"),
        createdById: ctx.userId,
      },
      select: { id: true },
    });
    return ok({ queued: true, id: job.id });
  },
);
