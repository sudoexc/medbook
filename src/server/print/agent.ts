/**
 * Print agents (prisma PrintAgent): a program on a clinic PC holding a
 * token, asking for ticket jobs and writing them to the network receipt
 * printer (owner request 09.10.2026). See src/server/print/agent-script.ts.
 */
import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

/** The agent counts as running when it asked for jobs this recently. */
export const AGENT_ONLINE_MS = 90_000;
/** A job nobody took by then is never printed late. */
export const JOB_STALE_MS = 2 * 60_000;
/** How long the client waits for the agent to take a job before it prints itself. */
export const JOB_PICKUP_MS = 8_000;

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The agent behind `Authorization: Bearer <token>`, or null. */
export async function agentFromRequest(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(header.trim());
  if (!m) return null;
  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.printAgent.findFirst({
      where: { tokenHash: hashAgentToken(m[1]!), active: true },
      select: { id: true, clinicId: true, printerHost: true, printerPort: true, codePage: true },
    }),
  );
}

/**
 * A new agent for the clinic; the clinic's earlier agents stop working (one
 * desk printer for now). Returns the token, shown once in the installer.
 */
export async function mintPrintAgent(args: {
  clinicId: string;
  printerHost: string;
  printerPort?: number;
}): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.$transaction([
      prisma.printAgent.updateMany({ where: { clinicId: args.clinicId, active: true }, data: { active: false } }),
      prisma.printAgent.create({
        data: {
          clinicId: args.clinicId,
          tokenHash: hashAgentToken(token),
          printerHost: args.printerHost,
          printerPort: args.printerPort ?? 9100,
        },
      }),
    ]),
  );
  return token;
}

/** The clinic's agent that is running now, if any. */
export async function onlineAgentOf(clinicId: string) {
  return runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.printAgent.findFirst({
      where: { clinicId, active: true, lastSeenAt: { gte: new Date(Date.now() - AGENT_ONLINE_MS) } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, codePage: true },
    }),
  );
}
