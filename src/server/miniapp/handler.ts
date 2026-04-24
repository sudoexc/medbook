/**
 * Telegram Mini App request helper.
 *
 * Every `/api/miniapp/*` endpoint follows the same shape:
 *
 *   1. Read `X-Telegram-Init-Data` header (the raw URL-encoded initData string
 *      surfaced by `window.Telegram.WebApp.initData`).
 *   2. Resolve the clinic by slug (`?clinicSlug=...` query or path param).
 *   3. Verify the init-data HMAC against the clinic's bot token.
 *   4. Upsert/find the patient by `telegramId` within the clinic.
 *   5. Run the inner handler inside `runWithTenant({ kind: "SYSTEM" })` with
 *      the resolved `{ clinicId, patientId }` in the context so the inner
 *      handler can scope every Prisma query explicitly.
 *
 * There is no PATIENT role in the system, so we cannot use the TENANT context
 * (which would auto-scope by clinicId but also apply user-based RBAC). Instead
 * the Mini App runs as SYSTEM and every handler MUST manually include
 * `clinicId` and `patientId` in every Prisma query — we give them those IDs
 * via the `MiniAppContext` argument.
 *
 * Spec: docs/TZ.md §6.10.7, §8.1.
 */
import type { ZodSchema } from "zod";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { verifyMiniAppInitData } from "@/server/telegram/auth";

export type MiniAppContext = {
  clinicId: string;
  clinicSlug: string;
  patientId: string;
  patient: {
    id: string;
    fullName: string;
    phone: string;
    preferredLang: "RU" | "UZ";
    telegramId: string | null;
    telegramUsername: string | null;
  };
  tgUser: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
};

export type MiniAppHandlerArgs<TBody> = {
  request: Request;
  body: TBody;
  ctx: MiniAppContext;
};

export type MiniAppOptions<TBody> = {
  /** If true, require a body and validate against this schema. */
  bodySchema?: ZodSchema<TBody>;
  /**
   * If true, skip automatic Patient upsert and just verify initData +
   * resolve clinic. The handler will receive `ctx.patientId = ""` and a
   * placeholder patient record. Used only by `/api/miniapp/auth` which
   * performs its own upsert logic.
   */
  skipPatientUpsert?: boolean;
};

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function readSlug(request: Request): string | null {
  const url = new URL(request.url);
  const qs = url.searchParams.get("clinicSlug");
  if (qs) return qs;
  // Fallback: /api/miniapp/clinic/:slug/... pattern (not currently used).
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("clinic");
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return null;
}

/**
 * Core: verify headers + resolve clinic/patient. Returns either an error
 * Response or a ready MiniAppContext.
 */
export async function resolveMiniAppContext(
  request: Request,
  opts: { skipPatientUpsert?: boolean } = {},
): Promise<{ ok: true; ctx: MiniAppContext } | { ok: false; response: Response }> {
  const initData = request.headers.get("x-telegram-init-data") ?? "";
  const bypassRequested =
    process.env.NODE_ENV !== "production" &&
    request.headers.get("x-miniapp-dev-bypass") === "1";
  // Empty initData is only acceptable in dev when the bypass header is set —
  // otherwise Telegram must have signed us.
  if (!initData && !bypassRequested) {
    return {
      ok: false,
      response: json(
        { error: "Unauthorized", reason: "missing_init_data" },
        { status: 401 },
      ),
    };
  }
  const slug = readSlug(request);
  if (!slug) {
    return {
      ok: false,
      response: json(
        { error: "BadRequest", reason: "missing_clinic_slug" },
        { status: 400 },
      ),
    };
  }
  // Raw (cross-tenant) clinic lookup — we need it before we know clinicId.
  const clinic = await prisma.clinic.findUnique({
    where: { slug },
    select: { id: true, slug: true, tgBotToken: true, active: true },
  });
  if (!clinic || !clinic.active) {
    return {
      ok: false,
      response: json({ error: "NotFound", reason: "clinic" }, { status: 404 }),
    };
  }
  // DEV convenience: when the clinic has no bot token configured yet, accept
  // a special dev bypass header so the Mini App can be developed locally
  // without a real bot. Never accepted in production.
  const devBypass =
    process.env.NODE_ENV !== "production" &&
    request.headers.get("x-miniapp-dev-bypass") === "1";

  let tgUser: MiniAppContext["tgUser"] | null = null;
  if (devBypass) {
    try {
      const raw = request.headers.get("x-miniapp-dev-user") ?? "";
      if (raw) tgUser = JSON.parse(raw) as MiniAppContext["tgUser"];
    } catch {
      /* ignore */
    }
    if (!tgUser) {
      tgUser = {
        id: 99999,
        first_name: "Dev",
        last_name: "User",
        username: "dev_miniapp",
        language_code: "ru",
      };
    }
  } else {
    if (!clinic.tgBotToken) {
      return {
        ok: false,
        response: json(
          { error: "Unauthorized", reason: "bot_not_configured" },
          { status: 503 },
        ),
      };
    }
    const verify = verifyMiniAppInitData(initData, clinic.tgBotToken);
    if (!verify.ok) {
      return {
        ok: false,
        response: json(
          { error: "Unauthorized", reason: verify.reason },
          { status: 401 },
        ),
      };
    }
    if (!verify.data.user) {
      return {
        ok: false,
        response: json(
          { error: "Unauthorized", reason: "missing_user" },
          { status: 401 },
        ),
      };
    }
    tgUser = verify.data.user as MiniAppContext["tgUser"];
  }

  // Patient resolution (unless caller asked to skip).
  if (opts.skipPatientUpsert) {
    return {
      ok: true,
      ctx: {
        clinicId: clinic.id,
        clinicSlug: clinic.slug,
        patientId: "",
        patient: {
          id: "",
          fullName: "",
          phone: "",
          preferredLang: "RU",
          telegramId: null,
          telegramUsername: null,
        },
        tgUser,
      },
    };
  }

  const tgIdStr = String(tgUser.id);
  const existing = await prisma.patient.findFirst({
    where: { clinicId: clinic.id, telegramId: tgIdStr },
    select: {
      id: true,
      fullName: true,
      phone: true,
      preferredLang: true,
      telegramId: true,
      telegramUsername: true,
    },
  });
  if (!existing) {
    return {
      ok: false,
      response: json(
        { error: "PatientNotRegistered", reason: "needs_auth" },
        { status: 428 },
      ),
    };
  }
  return {
    ok: true,
    ctx: {
      clinicId: clinic.id,
      clinicSlug: clinic.slug,
      patientId: existing.id,
      patient: existing,
      tgUser,
    },
  };
}

/**
 * Wrap a Mini App route handler. Parses body, verifies init-data, resolves
 * clinic + patient, then runs the handler inside a SYSTEM tenant scope.
 */
export function createMiniAppHandler<TBody = unknown>(
  opts: MiniAppOptions<TBody>,
  handler: (args: MiniAppHandlerArgs<TBody>) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const resolved = await resolveMiniAppContext(request, {
      skipPatientUpsert: opts.skipPatientUpsert,
    });
    if (!resolved.ok) return resolved.response;

    let body: TBody = undefined as TBody;
    if (opts.bodySchema) {
      try {
        const raw = await request.json();
        const parsed = opts.bodySchema.safeParse(raw);
        if (!parsed.success) {
          return json(
            { error: "ValidationError", issues: parsed.error.issues },
            { status: 400 },
          );
        }
        body = parsed.data;
      } catch {
        return json({ error: "InvalidJson" }, { status: 400 });
      }
    }

    return runWithTenant({ kind: "SYSTEM" }, () =>
      handler({ request, body, ctx: resolved.ctx }),
    );
  };
}

/**
 * GET-style wrapper without a body schema.
 */
export function createMiniAppListHandler(
  opts: Omit<MiniAppOptions<never>, "bodySchema"> = {},
  handler: (args: {
    request: Request;
    ctx: MiniAppContext;
  }) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const resolved = await resolveMiniAppContext(request, {
      skipPatientUpsert: opts.skipPatientUpsert,
    });
    if (!resolved.ok) return resolved.response;
    return runWithTenant({ kind: "SYSTEM" }, () =>
      handler({ request, ctx: resolved.ctx }),
    );
  };
}
