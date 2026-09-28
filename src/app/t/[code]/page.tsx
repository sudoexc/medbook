import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";
import { ipBucket, realClientIp } from "@/lib/client-ip";
import { rateLimit } from "@/lib/rate-limit";
import { queueTicketToken } from "@/server/appointments/public-ticket";

export const dynamic = "force-dynamic";

/**
 * Short codes resolved per address per minute. A patient scans once or
 * twice; the cap is only there so the 6-character code space cannot be
 * walked from one machine to find whose ticket is live today (audit INF-10).
 */
const RESOLVES_PER_MINUTE = 20;

export default async function TicketResolver({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-TV-Z]{4,12}$/.test(normalized)) notFound();

  const ip = ipBucket(realClientIp({ headers: await headers() }));
  if (!rateLimit(`ticket-code:${ip}`, RESOLVES_PER_MINUTE, 60_000, "ticket-code")) {
    notFound();
  }

  // Public short-link resolver — anonymous by design, the clinic is unknown
  // until the ticket code resolves. The code is the authorization
  // (fail-closed Prisma extension requires this explicit bypass).
  const appointment = await runUnscoped(
    "public ticket short-link: resolve appointment by ticketCode",
    () =>
      prisma.appointment.findUnique({
        where: { ticketCode: normalized },
        select: { id: true },
      }),
  );
  if (!appointment) notFound();

  // Onward to the signed ticket link, never the bare id (INF-10).
  redirect(`/q/${queueTicketToken(appointment.id)}`);
}
