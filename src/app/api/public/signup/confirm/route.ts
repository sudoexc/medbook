/**
 * Phase 19 Wave 2 — public signup confirmation.
 *
 * POST /api/public/signup/confirm  body: `{ token }`.
 *
 * Looks up the `ClinicSignupToken`, validates expiry + consumed status,
 * then in a single transaction:
 *   1. Create `Clinic` (slug = slugify(clinicName) + 4-char suffix).
 *   2. Create ADMIN `User` (mustChangePassword=true, temp password hash).
 *   3. Create Subscription on `basic` (TRIAL, trialEndsAt = now+14d).
 *   4. Apply playbook if `playbookSlug` is present (else "start blank").
 *   5. Stamp `consumedAt` + `consumedClinicId` on the token row.
 *   6. Stamp `clinic.onboardedAt` and `clinic.onboardingPlaybook`.
 *
 * Returns the temp password ONCE; the client surfaces it on the confirm
 * page and never persists it. The user is forced to change it at first
 * login by the existing `mustChangePassword` middleware redirect.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { ok, err } from "@/server/http";
import { SignupConfirmSchema } from "@/server/schemas/signup";
import { generateTempPassword, hashPassword } from "@/server/auth/password";
import { slugify } from "@/lib/slugify";
import { applyPlaybook } from "@/server/onboarding/apply-playbook";
import { isPlaybookSlug } from "@/server/onboarding/playbooks";

const TRIAL_DAYS = 14;

export const dynamic = "force-dynamic";

function randomSuffix(n: number): string {
  // Lowercase alphanumeric, no ambiguous chars — same alphabet philosophy
  // as the temp-password helper.
  const alpha = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < n; i++) {
    out += alpha[Math.floor(Math.random() * alpha.length)];
  }
  return out;
}

async function pickAvailableSlug(base: string): Promise<string> {
  // Tries a base slug, then `${base}-${suffix}` up to 5 times. Even with
  // ~30^4 = 810_000 combinations, retry once is enough; we cap to keep
  // a runaway loop impossible.
  const attempts: string[] = [];
  if (base.length >= 2) attempts.push(base);
  for (let i = 0; i < 5; i++) {
    attempts.push(`${base || "clinic"}-${randomSuffix(4)}`);
  }
  for (const candidate of attempts) {
    const taken = await prisma.clinic.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  // Fallback — astronomically unlikely. Use an 8-char suffix.
  return `${base || "clinic"}-${randomSuffix(8)}`;
}

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return err("InvalidJson", 400);
  }
  const parsed = SignupConfirmSchema.safeParse(raw);
  if (!parsed.success) {
    return err("ValidationError", 400, { issues: parsed.error.issues });
  }
  const { token } = parsed.data;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const tokenRow = await prisma.clinicSignupToken.findUnique({
      where: { token },
    });
    if (!tokenRow) {
      return err("InvalidToken", 400, { reason: "not_found" });
    }
    if (tokenRow.consumedAt) {
      // Already used. Audit so we can dashboard "abandoned-then-clicked"
      // and tell the visitor to log in instead.
      await audit(request, {
        action: AUDIT_ACTION.CLINIC_SELF_SIGNUP_TOKEN_EXPIRED,
        entityType: "ClinicSignupToken",
        entityId: tokenRow.id,
        meta: { email: tokenRow.email, reason: "consumed" },
      });
      return err("InvalidToken", 400, { reason: "consumed" });
    }
    if (tokenRow.expiresAt.getTime() <= Date.now()) {
      await audit(request, {
        action: AUDIT_ACTION.CLINIC_SELF_SIGNUP_TOKEN_EXPIRED,
        entityType: "ClinicSignupToken",
        entityId: tokenRow.id,
        meta: { email: tokenRow.email, reason: "expired" },
      });
      return err("InvalidToken", 400, { reason: "expired" });
    }

    // Belt-and-braces: even if the intake endpoint guard passed, between
    // intake and confirm someone might have grabbed the email through
    // another path (admin-created user). Reject before opening the
    // transaction so we don't leave half-built state.
    const emailTaken = await prisma.user.findUnique({
      where: { email: tokenRow.email },
      select: { id: true },
    });
    if (emailTaken) {
      return err("conflict", 409, { reason: "email_taken" });
    }

    const baseSlug = slugify(tokenRow.clinicName).slice(0, 50);
    const clinicSlug = await pickAvailableSlug(baseSlug);

    const tempPassword = generateTempPassword(12);
    const passwordHash = await hashPassword(tempPassword);

    const basicPlan = await prisma.plan.findUnique({
      where: { slug: "basic" },
      select: { id: true },
    });
    if (!basicPlan) {
      return err("PlatformMisconfigured", 500, { reason: "basic_plan_missing" });
    }

    const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const playbookSlug = tokenRow.playbookSlug;

    // Single transaction: every row needed for the clinic to be usable.
    // The playbook applier (which itself touches Service /
    // NotificationTemplate / Clinic) runs OUTSIDE this transaction so a
    // playbook hiccup doesn't roll back the user-creation path —
    // worst-case the admin ends up with a clinic that has no seeded
    // services and can fix it from settings. The token row is consumed
    // inside the txn so a retry can never re-provision.
    const created = await prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {
          slug: clinicSlug,
          nameRu: tokenRow.clinicName,
          nameUz: tokenRow.clinicName,
          phone: tokenRow.phone ?? null,
          email: tokenRow.email,
          // Default brand colour — the admin can rebrand later.
          brandColor: "#3DD5C0",
          currency: "UZS",
          active: true,
          onboardedAt: new Date(),
          onboardingPlaybook: playbookSlug ?? null,
        },
      });

      await tx.user.create({
        data: {
          clinicId: clinic.id,
          email: tokenRow.email,
          name: tokenRow.clinicName, // visitor didn't give us a personal
          // name — we use the clinic name as the display value and the
          // admin can fix it on first login.
          role: "ADMIN",
          active: true,
          passwordHash,
          mustChangePassword: true,
        },
      });

      await tx.subscription.create({
        data: {
          clinicId: clinic.id,
          planId: basicPlan.id,
          status: "TRIAL",
          trialEndsAt,
        },
      });

      await tx.clinicSignupToken.update({
        where: { id: tokenRow.id },
        data: {
          consumedAt: new Date(),
          consumedClinicId: clinic.id,
        },
      });

      return clinic;
    });

    // Apply the playbook AFTER the clinic exists. Errors are logged but
    // don't roll the signup back — the admin can re-pick a playbook from
    // settings later. We re-validate the slug here because the column is
    // a free-form string in the DB; the type guard narrows it to the
    // discriminated union the applier expects.
    if (playbookSlug && isPlaybookSlug(playbookSlug)) {
      try {
        await applyPlaybook(created.id, playbookSlug);
      } catch (e) {
        console.error("[signup-confirm] playbook apply failed", e);
      }
    }

    await audit(request, {
      action: AUDIT_ACTION.CLINIC_SELF_SIGNUP_COMPLETED,
      entityType: "Clinic",
      entityId: created.id,
      meta: {
        tokenId: tokenRow.id,
        email: tokenRow.email,
        planSlug: tokenRow.planSlug,
        playbookSlug: playbookSlug ?? null,
        preferredLocale: tokenRow.preferredLocale,
      },
    });

    return ok({
      ok: true,
      clinicId: created.id,
      clinicSlug: created.slug,
      email: tokenRow.email,
      tempPassword,
      locale: tokenRow.preferredLocale,
    });
  });
}
