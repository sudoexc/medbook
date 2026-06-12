"use client";

import * as React from "react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useClinic } from "../_hooks/use-clinic";
import { useMiniAppLiveEvents } from "../_hooks/use-miniapp-live-events";
import { FamilySwitcher } from "./family-switcher";

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
  const { themeParams, colorScheme, tg } = useTelegramWebApp();
  const { state } = useMiniAppAuth();
  const { data: clinic } = useClinic(clinicSlug);
  // Phase M3 — single SSE connection per page; the hook no-ops until auth
  // resolves and silently reconnects on backgrounding (Last-Event-ID via
  // `?since=` cold-start + browser-native Last-Event-ID warm reconnect).
  useMiniAppLiveEvents();

  const bg = themeParams.bg_color ?? (colorScheme === "dark" ? "#17212b" : "#f4f4f5");
  const text = themeParams.text_color ?? (colorScheme === "dark" ? "#f5f5f5" : "#0a0a0a");
  const hint = themeParams.hint_color ?? "#8f9ba7";
  const sectionBg =
    themeParams.section_bg_color ??
    (colorScheme === "dark" ? "#232e3c" : "#ffffff");
  // Phase M5 — read brand token from CSS. CSS-var-of-CSS-var resolves at
  // the consumer, so children that style with `var(--tg-accent)` still get
  // the brand colour even though we set it via JS inline style. Telegram's
  // `button_color` is intentionally NOT consulted — we don't want the
  // user's client default (teal on macOS, blue on Android) to bleed over
  // the NeuroFax mark.
  const accent = "var(--brand-primary, #2353FF)";

  const isDark = colorScheme === "dark";
  // Light shadows are invisible on a dark bg; dark cards separate from the
  // page with a faint inner ring + deeper drop instead.
  const cardShadow = isDark
    ? "0 0 0 1px rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.35)"
    : "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.05)";

  // Keep the native Telegram chrome (header strip + behind-keyboard area) in
  // the page colour, otherwise fullscreen mode shows a seam above the aurora.
  React.useEffect(() => {
    if (!tg) return;
    try {
      tg.setHeaderColor?.(bg);
      tg.setBackgroundColor?.(bg);
    } catch {
      // Older clients without the API — the default chrome is acceptable.
    }
  }, [tg, bg]);

  // The aurora layers are large blurred composited surfaces; pause their
  // drift while the app is backgrounded so they don't burn GPU/battery.
  React.useEffect(() => {
    const onVis = () => {
      document.documentElement.classList.toggle("ma-paused", document.hidden);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.documentElement.classList.remove("ma-paused");
    };
  }, []);

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
          // Drives CSS `light-dark()` in tokens + native form controls.
          colorScheme,
          // Expose theme colours to child CSS.
          "--tg-bg": bg,
          "--tg-text": text,
          "--tg-hint": hint,
          "--tg-section-bg": sectionBg,
          "--tg-accent": accent,
          "--ma-card-shadow": cardShadow,
        } as React.CSSProperties
      }
    >
      <MiniAppStyles />
      <MiniAppAurora />
      {/* No `sticky`, no `sectionBg`, no border — the header sits inside the
          page flow on the aurora gradient. Telegram chrome above already
          carries the bot identity; this just adds an in-app brand moment. */}
      <header
        className="relative z-10 flex flex-col items-center gap-2.5 px-4 pb-5"
        style={{
          paddingTop: "max(env(safe-area-inset-top), 1.25rem)",
        }}
      >
        <div className="relative">
          {/* Soft accent halo behind the logo. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-3 rounded-full blur-2xl opacity-60"
            style={{ backgroundColor: accent }}
          />
          {clinic?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinic.logoUrl}
              alt=""
              className="relative h-12 w-12 rounded-full object-cover"
              style={{
                boxShadow: `0 0 0 1px ${hint}33, 0 6px 20px -4px ${accent}55`,
              }}
            />
          ) : (
            <div
              className="relative grid h-12 w-12 place-items-center rounded-full text-lg font-bold"
              style={{
                backgroundColor: accent,
                color: "#fff",
                boxShadow: `0 0 0 1px ${hint}33, 0 6px 20px -4px ${accent}66`,
              }}
            >
              {(clinicName ?? clinicSlug).slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div
          className="truncate text-[15px] font-semibold leading-tight"
          style={{ letterSpacing: "-0.01em" }}
        >
          {clinicName ?? clinicSlug}
        </div>
      </header>
      <main className="relative z-10 mx-auto w-full max-w-[430px] px-4 pb-24 pt-4">
        {state.status === "ready" ? <FamilySwitcher slug={clinicSlug} /> : null}
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
      @keyframes ma-pulse {
        0%   { opacity: .55; }
        50%  { opacity: .9; }
        100% { opacity: .55; }
      }
      .ma-skeleton {
        background: color-mix(in oklch, var(--tg-hint) 22%, transparent);
        animation-name: ma-pulse;
        animation-iteration-count: infinite;
        animation-timing-function: ease-in-out;
        will-change: opacity;
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
      @keyframes ma-fade-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      .ma-fade-in {
        animation: ma-fade-in .25s ease-out both;
      }
      @keyframes ma-sheet-in {
        from { transform: translate3d(0, 100%, 0); }
        to   { transform: none; }
      }
      @keyframes ma-sheet-out {
        from { transform: none; }
        to   { transform: translate3d(0, 100%, 0); }
      }
      .ma-sheet-in {
        animation: ma-sheet-in .32s cubic-bezier(.2,.8,.2,1) both;
      }
      .ma-sheet-out {
        animation: ma-sheet-out .24s cubic-bezier(.4,0,.8,.4) both;
      }
      @keyframes ma-backdrop-in {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes ma-backdrop-out {
        from { opacity: 1; }
        to   { opacity: 0; }
      }
      .ma-backdrop-in {
        animation: ma-backdrop-in .25s ease-out both;
      }
      .ma-backdrop-out {
        animation: ma-backdrop-out .22s ease-in both;
      }
      @keyframes ma-toast-out {
        from { opacity: 1; transform: none; }
        to   { opacity: 0; transform: translate3d(0, 10px, 0) scale(.97); }
      }
      .ma-toast-out {
        animation: ma-toast-out .22s ease-in both;
      }
      @keyframes ma-check-pop {
        0%   { opacity: 0; transform: scale(.4); }
        65%  { opacity: 1; transform: scale(1.12); }
        100% { opacity: 1; transform: scale(1); }
      }
      .ma-check-pop {
        animation: ma-check-pop .5s cubic-bezier(.2,.8,.2,1) both;
      }
      .ma-draw {
        stroke-dasharray: 24;
        stroke-dashoffset: 24;
        animation: ma-draw .45s cubic-bezier(.2,.8,.2,1) .25s forwards;
      }
      @keyframes ma-draw {
        to { stroke-dashoffset: 0; }
      }
      @keyframes ma-ring {
        0%   { opacity: .5; transform: scale(.6); }
        100% { opacity: 0; transform: scale(1.6); }
      }
      .ma-ring {
        animation: ma-ring .9s ease-out .15s both;
      }
      .ma-paused .ma-aurora {
        animation-play-state: paused;
      }
      @media (prefers-reduced-motion: reduce) {
        .ma-aurora-a, .ma-aurora-b, .ma-aurora-c,
        .ma-fade-up, .ma-step-enter, .ma-skeleton, .ma-fade-in,
        .ma-sheet-in, .ma-sheet-out, .ma-backdrop-in, .ma-backdrop-out,
        .ma-toast-out, .ma-check-pop, .ma-draw, .ma-ring {
          animation: none !important;
        }
        .ma-draw {
          stroke-dashoffset: 0;
        }
      }
    `}</style>
  );
}
