/**
 * `/tv` and `/tv/d/<token>` live outside the [locale] segment, so no
 * next-intl provider reaches them. The boards speak both languages at once
 * (audit UX-06): this layout ships the `tvBoard` namespace of Russian and
 * Uzbek, and nothing else of the bundles, to the TV provider.
 */
import type { Viewport } from "next";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import { VersionWatch } from "@/components/version-watch";

import { TvI18nProvider } from "./_i18n";

// The boards are designed light (owner, 2026-07-06). Android TV's WebView
// darkened them on its own (the clinic's TCL, 08.10.2026); «only light»
// opts out of that automatic dark mode.
export const viewport: Viewport = { colorScheme: "only light" };

export default function TvLayout({ children }: { children: React.ReactNode }) {
  return (
    <TvI18nProvider messages={{ ru: ru.tvBoard, uz: uz.tvBoard }}>
      {/* A TV has nobody typing: it reloads after a deploy as soon as it is
          not calling a patient (09.10.2026). */}
      <VersionWatch idleMs={0} blockSelector="[data-call-takeover]" />
      {children}
    </TvI18nProvider>
  );
}
