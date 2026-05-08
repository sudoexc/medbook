/**
 * POST /api/crm/me/totp/enroll — start TOTP enrolment.
 *
 * Generates a fresh secret + otpauth URL and returns them. The secret is
 * NOT persisted yet — only the next /verify call commits it. That avoids a
 * half-enrolled state where a user fetches a secret and abandons the flow,
 * leaving a stale secret on their User row.
 *
 * Re-entry: a user who already has TOTP enabled cannot re-enroll without
 * disabling first; the endpoint returns 409.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { generateTotpSecret, buildOtpauthUrl } from "@/server/auth/totp";

export async function POST(_request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        email: true,
        totpEnabledAt: true,
        clinic: { select: { nameRu: true } },
      },
    });
    if (!me) return err("NotFound", 404);
    if (me.totpEnabledAt) return err("already_enrolled", 409);

    const secret = generateTotpSecret();
    const issuer = me.clinic?.nameRu ?? "MedBook CRM";
    const otpauthUrl = buildOtpauthUrl({
      issuer,
      account: me.email,
      secretBase32: secret,
    });

    return ok({ secret, otpauthUrl });
  });

  return result;
}
