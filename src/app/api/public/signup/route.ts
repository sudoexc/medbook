/**
 * Phase 19 Wave 2 — public self-service signup intake.
 *
 * POST /api/public/signup
 *
 * Anonymous endpoint (no session, no tenant context). The visitor submits
 * `clinicName + email + phone? + planSlug + playbookSlug? + preferredLocale`,
 * we mint a `ClinicSignupToken` row with a 24h TTL and EMAIL the magic link
 * to that address. The visitor clicks it to land on
 * `/[locale]/signup/confirm/[token]`, which finishes provisioning via the
 * companion `confirm` route.
 *
 * Audit MA-03: switched off unless PUBLIC_SIGNUP_ENABLED=1 (404 otherwise),
 * and the token is never returned to the caller: it used to be, which let
 * anyone create a clinic and an ADMIN on production under any address. In
 * production, no configured email delivery means no signup. Outside
 * production without SMTP the link is printed to the server console so local
 * development still works.
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
import { rateLimit } from "@/lib/rate-limit";
import { realClientIp } from "@/lib/client-ip";
import { sendSignupConfirmEmail } from "@/lib/email";
import {
  SIGNUP_LIMITS,
  isPublicSignupEnabled,
  renderSignupConfirmEmail,
  signupConfirmUrl,
  signupDisabledResponse,
  signupEmailConfigured,
} from "@/lib/public-signup";

// Token lifetime — long enough for a busy clinic owner to come back to it
// the next morning, short enough that a stolen confirm-link decays fast.
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Force dynamic so Next 16 doesn't try to statically optimise this POST
// (we read JSON body + write to the DB on every call).
export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  if (!isPublicSignupEnabled()) return signupDisabledResponse();

  if (
    !rateLimit(
      `signup-ip:${realClientIp(request)}`,
      SIGNUP_LIMITS.perIpPerHour,
      HOUR_MS,
      "signup",
    )
  ) {
    return err("too_many_requests", 429);
  }

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

  if (
    !rateLimit(
      `signup-email:${body.email}`,
      SIGNUP_LIMITS.perEmailPerHour,
      HOUR_MS,
      "signup",
    )
  ) {
    return err("too_many_requests", 429);
  }

  const canEmail = signupEmailConfigured();
  if (!canEmail && process.env.NODE_ENV === "production") {
    console.error("[signup] PUBLIC_SIGNUP_ENABLED is on but SMTP is not configured");
    return err("email_unavailable", 503);
  }

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

    const confirmUrl = signupConfirmUrl({
      requestUrl: request.url,
      locale: body.preferredLocale,
      token,
    });
    if (canEmail) {
      try {
        const mail = renderSignupConfirmEmail({
          locale: body.preferredLocale,
          clinicName: body.clinicName,
          confirmUrl,
        });
        await sendSignupConfirmEmail({ to: body.email, ...mail });
      } catch (e) {
        // Nobody can receive the link: withdraw the token rather than tell
        // the visitor to wait for an email that is not coming.
        console.error("[signup] confirmation email failed", e);
        await prisma.clinicSignupToken
          .delete({ where: { id: row.id } })
          .catch(() => {});
        return err("email_unavailable", 503);
      }
    } else {
      // Local development only (production without SMTP returned above).
      console.info(
        `[signup] dev confirm-link clinic="${body.clinicName}" email=${body.email} url=${confirmUrl} expiresAt=${expiresAt.toISOString()}`,
      );
    }

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

    // Never the token: the confirm link must only be reachable through the
    // inbox of the address being registered.
    return ok({ ok: true, expiresAt });
  });
}
