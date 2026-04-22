import * as React from "react";

import { QueryProvider } from "@/components/providers/query-provider";
import { MiniAppAuthProvider } from "./_components/miniapp-auth-provider";
import { MiniAppShell } from "./_components/mini-app-shell";

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
  return (
    <QueryProvider>
      <MiniAppAuthProvider clinicSlug={slug}>
        <MiniAppShell clinicSlug={slug}>{props.children}</MiniAppShell>
      </MiniAppAuthProvider>
    </QueryProvider>
  );
}
