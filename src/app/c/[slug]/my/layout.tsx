import * as React from "react";
import type { Viewport } from "next";

import { QueryProvider } from "@/components/providers/query-provider";
import { MiniAppAuthProvider } from "./_components/miniapp-auth-provider";
import { MiniAppErrorBoundary } from "./_components/error-boundary";
import { MiniAppShell } from "./_components/mini-app-shell";
import { MiniAppToastProvider } from "./_components/toast";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getFeatureFlags } from "@/server/platform/get-feature-flags";

// `viewport-fit=cover` is required so `env(safe-area-inset-top)` returns a
// real value — Telegram fullscreen mode otherwise overlaps the notch/clock.
export const viewport: Viewport = {
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

/**
 * Pure helper — given the brand colors, render the inline `<style>` body that
 * sets CSS custom properties on `:root`. Returns null when both inputs are
 * empty so we don't litter the DOM. Lifted out so it can be unit-tested.
 */
function renderBrandStyle(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string | null {
  const parts: string[] = [];
  if (primary) parts.push(`--brand-primary: ${primary};`);
  if (secondary) parts.push(`--brand-secondary: ${secondary};`);
  if (parts.length === 0) return null;
  return `:root{${parts.join("")}}`;
}

/**
 * Telegram Mini App layout: a standalone shell with NO CRM sidebar/topbar.
 * The viewport is mobile-first (375–430px) and the background/typography
 * adapts to `window.Telegram.WebApp.themeParams`.
 *
 * All data fetching happens through TanStack Query; the Mini App-specific
 * auth context lives inside `MiniAppAuthProvider` — it calls
 * `/api/miniapp/auth` on mount with the init-data header and exposes the
 * resolved patient + clinic to the whole subtree.
 */
export default async function MiniAppLayout(
  props: LayoutProps<"/c/[slug]/my">,
) {
  const { slug } = await props.params;
  // Phase 19 W4 — inject brand colors when the clinic owns hasWhiteLabel.
  // We resolve clinic-by-slug in SYSTEM context so this works for the
  // anonymous patient surface (no session yet) without leaking the row to
  // tenants that didn't pay for white-label.
  let brandStyle: string | null = null;
  try {
    const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.clinic.findUnique({
        where: { slug },
        select: { id: true, brandColor: true, brandSecondaryColor: true },
      }),
    );
    if (clinic) {
      const flags = await getFeatureFlags(clinic.id);
      if (flags.hasWhiteLabel) {
        brandStyle = renderBrandStyle(
          clinic.brandColor,
          clinic.brandSecondaryColor,
        );
      }
    }
  } catch {
    // Branding injection is best-effort — never fail the Mini App boot on
    // a DB hiccup.
  }
  return (
    <QueryProvider>
      {brandStyle ? (
        <style dangerouslySetInnerHTML={{ __html: brandStyle }} />
      ) : null}
      {/* Phase M4 — error boundary *outside* auth so a crash inside the
          auth provider still renders the fallback UI. We stamp clinicSlug
          on reports server-side; init-data is added inside the boundary
          via the auth provider once it's available. */}
      <MiniAppErrorBoundary context={{ clinicSlug: slug }}>
        <MiniAppToastProvider>
          <MiniAppAuthProvider clinicSlug={slug}>
            <MiniAppShell clinicSlug={slug}>{props.children}</MiniAppShell>
          </MiniAppAuthProvider>
        </MiniAppToastProvider>
      </MiniAppErrorBoundary>
    </QueryProvider>
  );
}
