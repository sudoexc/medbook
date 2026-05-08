/**
 * Phase 19 Wave 2 — public self-service signup intake.
 *
 * POST /api/public/signup
 *
 * Anonymous endpoint (no session, no tenant context). The visitor submits
 * `clinicName + email + phone? + planSlug + playbookSlug? + preferredLocale`,
 * we mint a `ClinicSignupToken` row with a 24h TTL, and return the token
 * to the caller. The client surfaces a "check your email" confirmation
 * screen and the visitor clicks the magic link to land on
 * `/[locale]/signup/confirm/[token]` which finishes provisioning via the
 * companion `confirm` route.
 *
 * Email delivery is NOT in scope for Wave 2 — we just `console.info` the
 * confirm-link so it's discoverable in dev. Wave 3+ wires the real email
 * service.
 *
 * The audit row lands BEFORE any clinic exists, so `clinicId` is null. The
 * `audit()` helper allows that — see `src/lib/audit.ts`.
 */
import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";
import { SignupRequestSchema } from "@/server/schemas/signup";

// Token lifetime — long enough for a busy clinic owner to come back to it
// the next morning, short enough that a stolen confirm-link decays fast.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Force dynamic so Next 16 doesn't try to statically optimise this POST
// (we read JSON body + write to the DB on every call).
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = SignupRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const body = parsed.data;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // Reject signup if a User with this email already exists. We DO NOT
    // surface "email already taken" granularity through any other channel
    // (logging-in is the recovery path); this is purely a fast guard so
    // we don't mint a token that can never be consumed.
    const existing = await prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true },
    });
    if (existing) {
      return err("conflict", 409, { reason: "email_taken" });
    }

    // url-safe random 24 bytes → 32 base64url chars. Plenty of entropy for
    // a single-use, 24h-lived token.
    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    const row = await prisma.clinicSignupToken.create({
      data: {
        email: body.email,
        clinicName: body.clinicName,
        phone: body.phone ?? null,
        planSlug: body.planSlug,
        playbookSlug: body.playbookSlug ?? null,
        preferredLocale: body.preferredLocale,
        token,
        expiresAt,
      },
    });

    // Wave 2: email service is out of scope. Log the confirm-link so dev
    // can pick it up; Wave 3 wires Resend / Postmark / whatever.
    const localePath = body.preferredLocale === "ru" ? "" : `/${body.preferredLocale}`;
    const confirmPath = `${localePath}/signup/confirm/${token}`;
    console.info(
      `[signup] confirm-link clinic="${body.clinicName}" email=${body.email} url=${confirmPath} expiresAt=${expiresAt.toISOString()}`,
    );

    await audit(request, {
      action: AUDIT_ACTION.CLINIC_SELF_SIGNUP_REQUESTED,
      entityType: "ClinicSignupToken",
      entityId: row.id,
      meta: {
        email: body.email,
        clinicName: body.clinicName,
        planSlug: body.planSlug,
        playbookSlug: body.playbookSlug ?? null,
        preferredLocale: body.preferredLocale,
      },
    });

    // We return the token to the caller. The confirm-link is only useful
    // to the visitor through email, but exposing the token from the POST
    // response also unblocks dev/test (no email service yet) — Wave 3
    // tightens this to "ok: true, message: ..." once email lands.
    return ok({ ok: true, token, expiresAt });
  });
}
