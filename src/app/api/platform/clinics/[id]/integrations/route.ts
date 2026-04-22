/**
 * GET  /api/platform/clinics/[id]/integrations — list ProviderConnection rows
 * POST /api/platform/clinics/[id]/integrations — upsert (create-or-update)
 *
 * Secrets are stored encrypted via `src/server/crypto/secrets.ts`. The API
 * never returns the plaintext; `secretMasked` is derived server-side for
 * display (last 4 chars of plaintext) and `hasSecret` is a boolean flag.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import {
  decrypt,
  encrypt,
  maskSecret,
} from "@/server/crypto/secrets";
import { ok, err, notFound } from "@/server/http";
import { platformAudit } from "@/server/platform/handler";
import {
  FAMILY_KINDS,
  UpsertPlatformIntegrationSchema,
} from "@/server/schemas/platform";

function clinicIdFromUrl(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const segs = url.pathname.split("/").filter(Boolean);
    // /api/platform/clinics/[id]/integrations
    //  0   1        2       3    4
    return segs[3] ?? null;
  } catch {
    return null;
  }
}

async function requireSuper(): Promise<
  { ok: true; userId: string } | { ok: false; response: Response }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, response: err("Unauthorized", 401) };
  if (session.user.role !== "SUPER_ADMIN") {
    return { ok: false, response: err("Forbidden", 403) };
  }
  return { ok: true, userId: session.user.id };
}

/** Redact a ProviderConnection for the wire — never include plaintext. */
function redact(row: {
  id: string;
  clinicId: string;
  kind: string;
  label: string | null;
  secretCipher: string;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): {
  id: string;
  clinicId: string;
  kind: string;
  label: string | null;
  hasSecret: boolean;
  secretMasked: string | null;
  config: unknown;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
} {
  let secretMasked: string | null = null;
  if (row.secretCipher) {
    try {
      const plain = decrypt(row.secretCipher);
      secretMasked = maskSecret(plain);
    } catch {
      // Legacy base64 rows (written by settings-pages-builder pre-crypto) or
      // tampered rows — fall back to an opaque placeholder.
      secretMasked = "••••";
    }
  }
  return {
    id: row.id,
    clinicId: row.clinicId,
    kind: row.kind,
    label: row.label,
    hasSecret: Boolean(row.secretCipher),
    secretMasked,
    config: row.config,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function GET(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();
    const rows = await prisma.providerConnection.findMany({
      where: { clinicId: id },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
    });
    return ok({
      clinic: { id: clinic.id, slug: clinic.slug, nameRu: clinic.nameRu },
      rows: rows.map((r) =>
        redact(r as unknown as Parameters<typeof redact>[0]),
      ),
      families: FAMILY_KINDS,
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireSuper();
  if (!gate.ok) return gate.response;
  return runWithTenant({ kind: "SUPER_ADMIN", userId: gate.userId }, async () => {
    const id = clinicIdFromUrl(request);
    if (!id) return err("BadRequest", 400);
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return err("InvalidJson", 400);
    }
    const parsed = UpsertPlatformIntegrationSchema.safeParse(raw);
    if (!parsed.success) {
      return err("ValidationError", 400, { issues: parsed.error.issues });
    }

    // Enforce family/kind coherence.
    const allowed = FAMILY_KINDS[parsed.data.family] ?? [];
    if (!allowed.includes(parsed.data.kind)) {
      return err("ValidationError", 400, {
        reason: "family_kind_mismatch",
        allowed,
      });
    }

    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) return notFound();

    const label = parsed.data.label ?? null;
    const existing = await prisma.providerConnection.findFirst({
      where: { clinicId: id, kind: parsed.data.kind, label },
    });

    let row;
    if (existing) {
      row = await prisma.providerConnection.update({
        where: { id: existing.id },
        data: {
          ...(parsed.data.secret !== undefined
            ? { secretCipher: encrypt(parsed.data.secret) }
            : {}),
          ...(parsed.data.config !== undefined
            ? { config: (parsed.data.config ?? {}) as never }
            : {}),
          ...(parsed.data.active !== undefined
            ? { active: parsed.data.active }
            : {}),
        },
      });
    } else {
      row = await prisma.providerConnection.create({
        data: {
          clinicId: id,
          kind: parsed.data.kind,
          label,
          secretCipher: parsed.data.secret
            ? encrypt(parsed.data.secret)
            : "",
          config: (parsed.data.config ?? {}) as never,
          active: parsed.data.active ?? true,
        },
      });
    }

    await platformAudit({
      request,
      userId: gate.userId,
      clinicId: id,
      action: existing ? "integration.update" : "integration.create",
      entityType: "ProviderConnection",
      entityId: row.id,
      meta: {
        family: parsed.data.family,
        kind: parsed.data.kind,
        label,
        secretChanged: parsed.data.secret !== undefined,
      },
    });
    return ok(redact(row as unknown as Parameters<typeof redact>[0]), existing ? 200 : 201);
  });
}
