/**
 * Thin wrapper around `app/api/.../route.ts` handlers.
 *
 * Responsibilities:
 *   1. Resolve the NextAuth session and reject unauthenticated requests.
 *   2. Enforce optional per-route RBAC (`opts.roles`).
 *   3. Validate the request body with Zod (if `opts.bodySchema`).
 *   4. Construct a `TenantContext` and run the inner handler inside
 *      `runWithTenant(...)` so the Prisma tenant-scope extension sees it.
 *
 * Kept intentionally small — richer primitives (pagination, audit-log,
 * idempotency) live in separate utilities and are composed on top.
 */

import type { ZodSchema } from "zod";

import { auth } from "./auth";
import { runWithTenant } from "./tenant-context";
import type { Role, TenantContext } from "./tenant-context";

export type ApiHandlerArgs<TBody> = {
  request: Request;
  body: TBody;
  ctx: TenantContext;
};

export type ApiHandlerOptions<TBody> = {
  roles?: Role[];
  bodySchema?: ZodSchema<TBody>;
  /**
   * If true (default), SUPER_ADMIN always bypasses role checks. Set to
   * `false` on endpoints that must reject SUPER_ADMIN explicitly.
   */
  allowSuperAdmin?: boolean;
  audit?: {
    action: string;
    entityType?: string;
  };
};

type Handler<TBody> = (args: ApiHandlerArgs<TBody>) => Promise<Response>;

function buildContext(user: {
  id: string;
  role: Role;
  clinicId: string | null;
}): TenantContext {
  if (user.role === "SUPER_ADMIN") {
    return { kind: "SUPER_ADMIN", userId: user.id };
  }
  if (!user.clinicId) {
    // Non-SUPER_ADMIN without a clinic is a schema invariant violation.
    // Treat as unauthorized to fail safe.
    throw Object.assign(new Error("User has no clinicId"), { status: 403 });
  }
  return {
    kind: "TENANT",
    clinicId: user.clinicId,
    userId: user.id,
    role: user.role,
  };
}

async function readSession() {
  const session = await auth();
  if (!session?.user) return null;
  return session;
}

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

async function checkRoles<TBody>(
  opts: ApiHandlerOptions<TBody>,
  role: Role
): Promise<Response | null> {
  if (!opts.roles || opts.roles.length === 0) return null;
  if (role === "SUPER_ADMIN" && opts.allowSuperAdmin !== false) return null;
  if (opts.roles.includes(role)) return null;
  return json({ error: "Forbidden" }, { status: 403 });
}

async function parseBody<TBody>(
  request: Request,
  schema: ZodSchema<TBody> | undefined
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
          { status: 400 }
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

/**
 * Create an API handler that expects a JSON request body.
 *
 * Example:
 * ```ts
 * export const POST = createApiHandler(
 *   { roles: ["ADMIN", "RECEPTIONIST"], bodySchema: PatientCreateSchema },
 *   async ({ body }) => {
 *     const patient = await prisma.patient.create({ data: body })
 *     return Response.json(patient, { status: 201 })
 *   }
 * )
 * ```
 */
export function createApiHandler<TBody = unknown>(
  opts: ApiHandlerOptions<TBody>,
  handler: Handler<TBody>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const session = await readSession();
    if (!session) return json({ error: "Unauthorized" }, { status: 401 });

    const user = session.user;
    const roleResp = await checkRoles(opts, user.role);
    if (roleResp) return roleResp;

    const parsed = await parseBody(request, opts.bodySchema);
    if (!parsed.ok) return parsed.response;

    let ctx: TenantContext;
    try {
      ctx = buildContext({
        id: user.id,
        role: user.role,
        clinicId: user.clinicId,
      });
    } catch (e) {
      const status = (e as Error & { status?: number }).status ?? 403;
      return json({ error: "Forbidden" }, { status });
    }

    return runWithTenant(ctx, () =>
      handler({ request, body: parsed.body, ctx })
    );
  };
}

/**
 * Create a GET handler that does not read a JSON body. Query-string parsing
 * is the caller's responsibility (use `new URL(request.url).searchParams`).
 */
export function createApiListHandler(
  opts: Omit<ApiHandlerOptions<never>, "bodySchema">,
  handler: (args: {
    request: Request;
    ctx: TenantContext;
  }) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const session = await readSession();
    if (!session) return json({ error: "Unauthorized" }, { status: 401 });

    const user = session.user;
    const roleResp = await checkRoles(opts, user.role);
    if (roleResp) return roleResp;

    let ctx: TenantContext;
    try {
      ctx = buildContext({
        id: user.id,
        role: user.role,
        clinicId: user.clinicId,
      });
    } catch (e) {
      const status = (e as Error & { status?: number }).status ?? 403;
      return json({ error: "Forbidden" }, { status });
    }

    return runWithTenant(ctx, () => handler({ request, ctx }));
  };
}
