/**
 * /crm/me/security — TOTP enrolment / disable / recovery codes.
 *
 * Server component just resolves the session + the user's current TOTP
 * state and hands them to the client. The client owns the three view
 * modes (not-enrolled / enrolling / enrolled).
 */
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { isMandatory2faRole } from "@/server/auth/security-policy";

import { SecurityClient } from "./_components/security-client";

type Params = Promise<{ locale: string }>;

export default async function MeSecurityPage({
  params,
}: {
  params: Params;
}) {
  const { locale } = await params;
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const me = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        role: true,
        totpEnabledAt: true,
        clinic: {
          select: { require2faForAll: true },
        },
      },
    }),
  );

  if (!me) redirect(`/${locale}/login`);

  const enrolled = Boolean(me.totpEnabledAt);
  const mandatory =
    isMandatory2faRole(me.role) || (me.clinic?.require2faForAll ?? false);

  return (
    <SecurityClient
      enrolled={enrolled}
      mandatory={mandatory}
      enrolledAt={me.totpEnabledAt?.toISOString() ?? null}
    />
  );
}
