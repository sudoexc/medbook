import * as React from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"

import { auth } from "@/lib/auth"
import { CrmSidebar } from "@/components/layout/crm-sidebar"
import { CrmTopbar } from "@/components/layout/crm-topbar"
import { ImpersonationBanner } from "@/components/layout/impersonation-banner"
import { TrialBanner } from "@/components/layout/trial-banner"
import { QueryProvider } from "@/components/providers/query-provider"
import { prisma } from "@/lib/prisma"
import { runWithTenant } from "@/lib/tenant-context"
import { ACTIVE_BRANCH_COOKIE_NAME } from "@/server/platform/branch-cookie"
import { getFeatureFlagsForCurrentSession } from "@/server/platform/current-flags"
import { getCurrentSubscription } from "@/server/platform/current-subscription"
import { AUDIT_ACTION } from "@/lib/audit-actions"

/**
 * Pure helper — given the brand color hex strings, render an inline `<style>`
 * tag that sets CSS custom properties on `:root`. Returns `null` when both
 * inputs are absent so we don't litter the DOM with empty tags. Kept tiny so
 * the unit test in `tests/unit/branding-update.test.ts` can assert the
 * expected output without booting React.
 */
// Reject anything that isn't a 3- or 6-digit hex literal so a malicious clinic
// can't terminate the declaration and inject arbitrary CSS via `brandColor`.
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

function renderBrandStyle(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string | null {
  const lines: string[] = []
  if (primary && HEX_COLOR.test(primary)) lines.push(`--brand-primary: ${primary};`)
  if (secondary && HEX_COLOR.test(secondary)) lines.push(`--brand-secondary: ${secondary};`)
  if (lines.length === 0) return null
  return `:root{${lines.join("")}}`
}

export default async function CrmLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const t = await getTranslations("crmLayout")
  // We read the session here so the topbar (and the BranchSwitcher inside)
  // know who the user is. The hardcoded fallback values below preserve the
  // legacy demo-friendly render when the session is missing — pages enforce
  // their own auth, so the layout never blocks.
  const session = await auth()
  // Mirror the guard in /[locale]/doctor/layout.tsx: a DOCTOR who manually
  // navigates to /crm has nothing to do here. Bounce them to their own
  // surface so the login UX promise ("you land where your role belongs")
  // holds even when the URL is typed by hand.
  if (session?.user?.role === "DOCTOR") {
    const { locale } = await params
    redirect(`/${locale}/doctor`)
  }
  const cookieStore = await cookies()
  const branchCookie = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value || null
  // Phase 9d — resolve plan-aware nav flags once on the server. The sidebar
  // uses this to hide pro-only menu items; the gated `page.tsx` files run
  // their own `notFound()` guards as defense-in-depth.
  // Phase 9e — also resolve the current subscription so the trial / past-due
  // banner can render above the topbar. Both calls hit Postgres so we run
  // them in parallel to keep the layout fast on every CRM page.
  const [flags, subscription] = await Promise.all([
    getFeatureFlagsForCurrentSession(),
    getCurrentSubscription(),
  ])
  // Phase 4 — when a SUPER_ADMIN is browsing CRM with an active clinic
  // override, surface a yellow banner above the topbar with «Выйти» that
  // clears the cookie and returns to /admin/clinics. The banner is
  // intentionally sticky on every CRM page so impersonation can never be
  // forgotten while clicking around.
  // Phase 19 W4 — also pulls the impersonation `mode` to flip the banner
  // colour and the inline brand-color block when `hasWhiteLabel` is on.
  let impersonatedClinic: {
    nameRu: string
    slug: string
    brandColor: string | null
    brandSecondaryColor: string | null
  } | null = null
  let impersonationMode: "WRITE" | "VIEW_ONLY" | null = null
  if (
    session?.user?.role === "SUPER_ADMIN" &&
    session.user.clinicId
  ) {
    // Grant-expiry guard: when the JWT carried clinicId via the override
    // cookie but the grant row has aged out, the auth callback drops the
    // `impersonation` stamp. Detect that here, audit the expiry, clear the
    // cookies, and bounce back to /admin/clinics. This is the layout-level
    // safety net; the API wrapper's VIEW_ONLY block handles the same case
    // for in-flight XHRs.
    if (!session.user.impersonation) {
      try {
        await runWithTenant({ kind: "SUPER_ADMIN", userId: session.user.id }, async () => {
          await prisma.auditLog.create({
            data: {
              clinicId: session.user.clinicId as string,
              actorId: session.user.id,
              actorRole: "SUPER_ADMIN",
              actorLabel: "platform",
              action: AUDIT_ACTION.SUPER_ADMIN_IMPERSONATE_EXPIRED,
              entityType: "Clinic",
              entityId: session.user.clinicId as string,
              meta: { reason: "grant_missing_or_expired" } as never,
            },
          })
        })
      } catch (err) {
        console.error("[crm/layout] failed to audit IMPERSONATE_EXPIRED", err)
      }
      redirect("/admin/clinics?expired=1")
    }
    impersonationMode = session.user.impersonation.mode
    impersonatedClinic = await runWithTenant(
      { kind: "SUPER_ADMIN", userId: session.user.id },
      () =>
        prisma.clinic.findUnique({
          where: { id: session.user.clinicId as string },
          select: {
            nameRu: true,
            slug: true,
            brandColor: true,
            brandSecondaryColor: true,
          },
        }),
    )
  }
  // Phase 19 W4 — inject brand colours when the clinic owns the white-label
  // feature flag. Falls back to the design-system defaults otherwise. We
  // resolve the source row off the session's clinicId for a real tenant user;
  // for SUPER_ADMIN impersonation we already loaded it above.
  let brandPrimary: string | null = null
  let brandSecondary: string | null = null
  if (flags.hasWhiteLabel) {
    if (impersonatedClinic) {
      brandPrimary = impersonatedClinic.brandColor
      brandSecondary = impersonatedClinic.brandSecondaryColor
    } else if (session?.user?.clinicId) {
      const own = await runWithTenant(
        {
          kind: "TENANT",
          clinicId: session.user.clinicId,
          userId: session.user.id,
          role: session.user.role,
        },
        () =>
          prisma.clinic.findUnique({
            where: { id: session.user.clinicId as string },
            select: { brandColor: true, brandSecondaryColor: true },
          }),
      )
      brandPrimary = own?.brandColor ?? null
      brandSecondary = own?.brandSecondaryColor ?? null
    }
  }
  const brandStyle = renderBrandStyle(brandPrimary, brandSecondary)
  return (
    <QueryProvider>
      {brandStyle ? (
        <style dangerouslySetInnerHTML={{ __html: brandStyle }} />
      ) : null}
      <div className="flex h-screen min-h-0 w-full bg-background">
        <CrmSidebar
          flags={flags}
          role={
            session?.user?.role === "ADMIN" ||
            session?.user?.role === "SUPER_ADMIN"
              ? "ADMIN"
              : null
          }
        />
        <div className="flex min-w-0 flex-1 flex-col">
          {impersonatedClinic && (
            <ImpersonationBanner
              clinicName={impersonatedClinic.nameRu}
              clinicSlug={impersonatedClinic.slug}
              mode={impersonationMode}
            />
          )}
          <TrialBanner subscription={subscription} />
          <CrmTopbar
            userEmail={session?.user?.email ?? "admin@neurofax.uz"}
            userName={session?.user?.name ?? t("adminFallbackName")}
            userRole={session?.user?.role ?? null}
            currentClinicId={session?.user?.clinicId ?? null}
            currentBranchId={branchCookie}
          />
          <main className="min-h-0 flex-1 overflow-y-auto bg-surface">
            {children}
          </main>
        </div>
      </div>
    </QueryProvider>
  )
}
