/**
 * POST /api/crm/me/password — set the current user's password.
 *
 * Authenticated users only. Verifies `currentPassword` unless this session was
 * opened a few minutes ago with an admin-issued temporary password (see
 * `mayOmitCurrentPassword`, audit SEC-07). Always clears `mustChangePassword`
 * so the proxy redirect releases.
 *
 * A new password ends every OTHER session of the account: if the old password
 * leaked, changing it must also push out whoever is already signed in with it.
 * The session that made the change stays signed in.
 *
 * NOTE: deliberately not using `createApiHandler` here — that helper rejects
 * SUPER_ADMINs who haven't impersonated a clinic, but a SUPER_ADMIN should
 * still be able to change their own password from anywhere.
 */
import bcrypt from "bcryptjs";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { runWithTenant } from "@/lib/tenant-context";
import { ok, err } from "@/server/http";
import { hashPassword } from "@/server/auth/password";
import { mayOmitCurrentPassword } from "@/server/auth/password-change";
import { revokeUserSessions } from "@/server/auth/session-guard";
import {
  findSessionByCookie,
  readSessionCookie,
} from "@/server/auth/user-session";

const Schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(200),
});

/** The UserSession row of the caller, so revoking "the others" spares it. */
async function callerSessionId(fromJwt: string | null | undefined) {
  if (fromJwt) return fromJwt;
  // Sessions minted before JWTs carried the id: find it by the cookie.
  try {
    const row = await findSessionByCookie(await readSessionCookie());
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return err("Unauthorized", 401);

  // Guessing the current password through an open session is still guessing.
  if (!rateLimit(`pw-change:${session.user.id}`, 10, 15 * 60 * 1000, "pw-change")) {
    return err("too_many_attempts", 429);
  }

  let parsed;
  try {
    const raw = await request.json();
    parsed = Schema.safeParse(raw);
  } catch {
    return err("InvalidJson", 400);
  }
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const { currentPassword, newPassword } = parsed.data;

  const result = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, passwordHash: true, mustChangePassword: true },
    });
    if (!user) return { response: err("NotFound", 404) };

    const skipCurrent = mayOmitCurrentPassword({
      hasPassword: Boolean(user.passwordHash),
      mustChangePassword: user.mustChangePassword,
      tempPasswordLoginAt: session.user.tempPasswordLoginAt,
    });
    if (!skipCurrent && user.passwordHash) {
      if (!currentPassword) {
        return { response: err("validation", 400, { reason: "current_required" }) };
      }
      const matches = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!matches) return { response: err("invalid_current", 400) };
    }

    const passwordHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });
    return { response: null };
  });
  if (result.response) return result.response;

  try {
    await revokeUserSessions(session.user.id, {
      exceptSessionId: await callerSessionId(session.user.sessionId),
    });
  } catch (e) {
    // The password is already changed; a failed cleanup must not turn that
    // into an error the user would retry.
    console.error("[me/password] revoking other sessions failed", e);
  }
  return ok({ ok: true });
}
