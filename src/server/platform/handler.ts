/**
 * API handler helpers for `/api/platform/*` — SUPER_ADMIN-only endpoints.
 *
 * These run inside `runWithTenant({ kind: "SUPER_ADMIN", userId })` so the
 * Prisma extension does NOT auto-inject `clinicId`. Each handler must
 * therefore pass `clinicId` explicitly when it needs to scope to a single
 * clinic (or omit it for cross-tenant reads).
 *
 * Kept separate from `src/lib/api-handler.ts` so we can gate on SUPER_ADMIN
 * by default (the CRM handler lets ADMIN pass too). Routes that do not use
 * the wrappers call `requireSuperAdmin()` themselves: no local copies of the
 * role check, so the 2FA requirement cannot be forgotten in one of them.
 */
import type { ZodSchema } from "zod";

import { auth } from "@/lib/auth";
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { clientIpForAudit } from "@/lib/client-ip";
import { mfaRequiredResponse, owesTotpEnrolment } from "@/server/auth/mfa-gate";

type PlatformArgs<TBody> = {
  request: Request;
  body: TBody;
  userId: string;
};

type PlatformOptions<TBody> = {
  bodySchema?: ZodSchema<TBody>;
};

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

async function parseBody<TBody>(
  request: Request,
  schema: ZodSchema<TBody> | undefined,
): Promise<{ ok: true; body: TBody } | { ok: false; response: Response }> {
  if (!schema) return { ok: true, body: undefined as TBody };
  try {
    const raw = await request.json();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        response: json(
          { error: "ValidationError", issues: parsed.error.issues },
          { status: 400 },
        ),
      };
    }
    return { ok: true, body: parsed.data };
  } catch {
    return {
      ok: false,
      response: json({ error: "InvalidJson" }, { status: 400 }),
    };
  }
}

export type SuperAdminGate =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/**
 * The one gate of every /api/platform and /api/admin endpoint: a signed-in
 * SUPER_ADMIN WITH an enrolled second factor (audit SEC-08). The role is
 * mandatory-2FA in `security-policy.ts`, but until SEC-08 nothing on the
 * control plane checked it: a leaked password alone could reset a clinic
 * owner's password or enter a clinic.
 *
 * `{ mfa: false }` is for the one call that only DROPS privilege (leaving an
 * impersonated clinic), so a SUPER_ADMIN caught mid-grant by the rollout can
 * always get out. It is not for anything that reads or changes data.
 */
export async function requireSuperAdmin(
  opts: { mfa?: boolean } = {},
): Promise<SuperAdminGate> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  if (
    opts.mfa !== false &&
    (await owesTotpEnrolment(session.user.id, "SUPER_ADMIN"))
  ) {
    return { ok: false, response: mfaRequiredResponse() };
  }
  return { ok: true, userId: session.user.id };
}

/**
 * Create a mutation handler (POST / PATCH / DELETE) that parses a JSON body
 * and runs inside a SUPER_ADMIN tenant context.
 */
export function createPlatformHandler<TBody = unknown>(
  opts: PlatformOptions<TBody>,
  handler: (args: PlatformArgs<TBody>) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const sess = await requireSuperAdmin();
    if (!sess.ok) return sess.response;
    const parsed = await parseBody(request, opts.bodySchema);
    if (!parsed.ok) return parsed.response;
    return runWithTenant({ kind: "SUPER_ADMIN", userId: sess.userId }, () =>
      handler({ request, body: parsed.body, userId: sess.userId }),
    );
  };
}

/**
 * Create a GET handler (no JSON body). Query-string parsing is the caller's
 * responsibility.
 */
export function createPlatformListHandler(
  handler: (args: {
    request: Request;
    userId: string;
  }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const sess = await requireSuperAdmin();
    if (!sess.ok) return sess.response;
    return runWithTenant({ kind: "SUPER_ADMIN", userId: sess.userId }, () =>
      handler({ request, userId: sess.userId }),
    );
  };
}

/**
 * Shared audit helper — platform-level actions always record their
 * actor as SUPER_ADMIN. `clinicId` is optional (null for truly global
 * actions like creating a new clinic).
 */
export async function platformAudit(input: {
  request: Request;
  userId: string;
  clinicId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: unknown;
}): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: input.clinicId ?? null,
        actorId: input.userId,
        actorRole: "SUPER_ADMIN",
        actorLabel: "platform",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        meta: (input.meta ?? null) as never,
        ip: clientIpForAudit(input.request),
        userAgent:
          input.request.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
  } catch (e) {
    console.error("[platform-audit]", e);
  }
}

export function idFromUrl(request: Request, position = 4): string | null {
  // /api/platform/clinics/[id]/...
  //  0   1        2       3
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    return segs[position] ?? null;
  } catch {
    return null;
  }
}
