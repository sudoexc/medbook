import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export default async function TicketResolver({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-TV-Z]{4,12}$/.test(normalized)) notFound();

  // Public short-link resolver — anonymous by design, the clinic is unknown
  // until the ticket code resolves. The unguessable code is the authorization
  // (fail-closed Prisma extension requires this explicit bypass).
  const appointment = await runUnscoped(
    "public ticket short-link: resolve appointment by unguessable ticketCode",
    () =>
      prisma.appointment.findUnique({
        where: { ticketCode: normalized },
        select: { id: true },
      }),
  );
  if (!appointment) notFound();

  redirect(`/q/${appointment.id}`);
}
