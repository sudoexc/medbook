import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function TicketResolver({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const normalized = code.trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-TV-Z]{4,12}$/.test(normalized)) notFound();

  const appointment = await prisma.appointment.findUnique({
    where: { ticketCode: normalized },
    select: { id: true },
  });
  if (!appointment) notFound();

  redirect(`/q/${appointment.id}`);
}
