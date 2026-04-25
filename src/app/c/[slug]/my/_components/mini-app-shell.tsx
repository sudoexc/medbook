"use client";

import * as React from "react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useClinic } from "../_hooks/use-clinic";

/**
 * Top-level Mini App shell. Applies Telegram theme colours to the root and
 * renders a compact header with the clinic name. Children scroll vertically
 * inside a padded container sized for 375–430px viewports.
 */
export function MiniAppShell({
  clinicSlug,
  children,
}: {
  clinicSlug: string;
  children: React.ReactNode;
}) {
  const { themeParams, colorScheme } = useTelegramWebApp();
  const { state } = useMiniAppAuth();
  const { data: clinic } = useClinic(clinicSlug);

  const bg = themeParams.bg_color ?? (colorScheme === "dark" ? "#17212b" : "#f4f4f5");
  const text = themeParams.text_color ?? (colorScheme === "dark" ? "#f5f5f5" : "#0a0a0a");
  const hint = themeParams.hint_color ?? "#8f9ba7";
  const sectionBg =
    themeParams.section_bg_color ??
    (colorScheme === "dark" ? "#232e3c" : "#ffffff");
  // NeuroFax brand blue — hard-coded so the Mini App stays on-brand even
  // when Telegram's `button_color` theme param would otherwise paint the
  // UI in the user's default client colour (teal by default).
  const accent = "#2353FF";

  const lang =
    state.status === "ready"
      ? state.patient.preferredLang.toLowerCase()
      : "ru";
  const clinicName =
    lang === "uz" ? clinic?.nameUz ?? clinic?.nameRu : clinic?.nameRu;

  return (
    <div
      className="relative min-h-dvh w-full antialiased"
      style={
        {
          backgroundColor: bg,
          color: text,
          // Expose theme colours to child CSS.
          "--tg-bg": bg,
          "--tg-text": text,
          "--tg-hint": hint,
          "--tg-section-bg": sectionBg,
          "--tg-accent": accent,
        } as React.CSSProperties
      }
    >
      <MiniAppStyles />
      <MiniAppAurora />
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 pb-3"
        style={{
          backgroundColor: sectionBg,
          borderBottom: `1px solid ${hint}22`,
          // In Telegram fullscreen mode the system status bar + notch
          // overlap the top of the webview. `env(safe-area-inset-top)` is 0
          // on some clients (iMe, Desktop stub), so we `max()` it with a
          // generous floor that clears the notch on iPhone 12+ reliably.
          paddingTop:
            "max(env(safe-area-inset-top), 2.75rem)",
        }}
      >
        {clinic?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <div
            className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold"
            style={{ backgroundColor: accent, color: "#fff" }}
          >
            {clinicName?.slice(0, 1) ?? "C"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">
            {clinicName ?? clinicSlug}
          </div>
          {clinic?.addressRu ? (
            <div className="truncate text-xs" style={{ color: hint }}>
              {lang === "uz" ? clinic.addressUz ?? clinic.addressRu : clinic.addressRu}
            </div>
          ) : null}
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-[430px] px-4 pb-24 pt-4">
        {children}
      </main>
    </div>
  );
}

/**
 * Ambient aurora gradient that drifts behind the content — purely decorative,
 * modelled after the Telegram Premium / Wallet / Fragment screens. Absolutely
 * positioned at the bottom so the scrolling content overlays it cleanly.
 */
function MiniAppAurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      <div className="ma-aurora ma-aurora-a" />
      <div className="ma-aurora ma-aurora-b" />
      <div className="ma-aurora ma-aurora-c" />
    </div>
  );
}

/**
 * Scoped keyframes + utilities for Mini App motion. Kept inline so the
 * animations don't leak into the CRM bundle.
 */
function MiniAppStyles() {
  return (
    <style>{`
      @keyframes ma-aurora-drift-a {
        0%   { transform: translate3d(-12%, 8%, 0) scale(1); }
        50%  { transform: translate3d(18%, -4%, 0) scale(1.15); }
        100% { transform: translate3d(-12%, 8%, 0) scale(1); }
      }
      @keyframes ma-aurora-drift-b {
        0%   { transform: translate3d(14%, 10%, 0) scale(1.05); }
        50%  { transform: translate3d(-16%, -6%, 0) scale(0.95); }
        100% { transform: translate3d(14%, 10%, 0) scale(1.05); }
      }
      @keyframes ma-aurora-drift-c {
        0%   { transform: translate3d(0%, 14%, 0) scale(1); }
        50%  { transform: translate3d(0%, -10%, 0) scale(1.1); }
        100% { transform: translate3d(0%, 14%, 0) scale(1); }
      }
      @keyframes ma-fade-up {
        from { opacity: 0; transform: translate3d(0, 14px, 0); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes ma-step-enter {
        from { opacity: 0; transform: translate3d(0, 24px, 0) scale(0.985); filter: blur(2px); }
        to   { opacity: 1; transform: none; filter: none; }
      }
      .ma-aurora {
        position: absolute;
        border-radius: 9999px;
        filter: blur(70px);
        will-change: transform;
      }
      .ma-aurora-a {
        left: -15%; bottom: -10%; width: 70vw; height: 55vh;
        background: radial-gradient(circle at 30% 30%, color-mix(in oklch, var(--tg-accent) 55%, transparent), transparent 70%);
        animation: ma-aurora-drift-a 18s ease-in-out infinite;
      }
      .ma-aurora-b {
        right: -20%; bottom: -20%; width: 80vw; height: 60vh;
        background: radial-gradient(circle at 60% 40%, color-mix(in oklch, var(--tg-accent) 35%, #7aa0ff), transparent 70%);
        animation: ma-aurora-drift-b 22s ease-in-out infinite;
        opacity: .7;
      }
      .ma-aurora-c {
        left: 10%; bottom: 20%; width: 60vw; height: 40vh;
        background: radial-gradient(circle at 50% 50%, color-mix(in oklch, var(--tg-accent) 20%, #c2a0ff), transparent 70%);
        animation: ma-aurora-drift-c 26s ease-in-out infinite;
        opacity: .45;
      }
      .ma-fade-up {
        animation: ma-fade-up .55s cubic-bezier(.2,.8,.2,1) both;
      }
      .ma-step-enter {
        animation: ma-step-enter .42s cubic-bezier(.2,.8,.2,1) both;
      }
      @media (prefers-reduced-motion: reduce) {
        .ma-aurora-a, .ma-aurora-b, .ma-aurora-c,
        .ma-fade-up, .ma-step-enter {
          animation: none !important;
        }
      }
    `}</style>
  );
}
