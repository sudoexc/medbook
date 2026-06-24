"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Home, MessageCircle, UserRound } from "lucide-react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useT } from "./mini-i18n";
import { useClinic } from "../_hooks/use-clinic";
import { useMiniAppLiveEvents } from "../_hooks/use-miniapp-live-events";
import { FamilySwitcher } from "./family-switcher";

// Focused flows own the bottom edge (wizard footer, NPS/pre-visit CTAs,
// native MainButton on account-delete / family-add), so the tab bar steps
// aside there.
const TABBAR_HIDDEN_RE =
  /\/my\/(book|pre-visit|nps|account\/delete|family\/add)(\/|$)/;
// Bar content height; safe-area inset is added on top of this.
const TABBAR_OFFSET = "calc(3.75rem + max(env(safe-area-inset-bottom), 0.5rem))";

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
  const pathname = usePathname() ?? "";
  const base = `/c/${clinicSlug}/my`;
  const isHome = pathname === base || pathname === `${base}/`;
  const showTabBar =
    state.status === "ready" && !TABBAR_HIDDEN_RE.test(pathname);
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

  // The offset lives on <html> (not the shell root) because the toast
  // viewport portals outside the shell subtree and still needs to float
  // above the tab bar.
  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--ma-tabbar-offset",
      showTabBar ? TABBAR_OFFSET : "0px",
    );
    return () => {
      document.documentElement.style.removeProperty("--ma-tabbar-offset");
    };
  }, [showTabBar]);

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
          // Semantic status colours — same palette as the tone() pairs in
          // mini-app-tokens.ts. Text vars are contrast-safe on the section bg
          // in both schemes; *-solid are fills for white text (deeper in dark
          // so they don't glow). Screens must use these instead of raw hex.
          "--ma-success": "light-dark(#059669, #34d399)",
          "--ma-success-bg":
            "light-dark(color-mix(in oklch, #10b981 12%, transparent), color-mix(in oklch, #10b981 20%, transparent))",
          "--ma-success-solid": "light-dark(#059669, #047857)",
          "--ma-danger": "light-dark(#b91c1c, #f87171)",
          "--ma-danger-solid": "light-dark(#ef4444, #dc2626)",
          "--ma-warning": "light-dark(#b45309, #fbbf24)",
          "--ma-info": "light-dark(#0369a1, #38bdf8)",
        } as React.CSSProperties
      }
    >
      <MiniAppStyles />
      <MiniAppAurora />
      {/* Home gets the full brand moment (logo halo on the aurora); inner
          screens get a slim one-row header so content starts ~70px higher.
          Telegram chrome above already carries the bot identity. */}
      {isHome ? (
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
      ) : (
        <header
          className="relative z-10 flex items-center justify-center gap-2 px-4 pb-3"
          style={{
            paddingTop: "max(env(safe-area-inset-top), 0.75rem)",
          }}
        >
          {clinic?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={clinic.logoUrl}
              alt=""
              className="h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              {(clinicName ?? clinicSlug).slice(0, 1).toUpperCase()}
            </div>
          )}
          <div
            className="truncate text-sm font-semibold leading-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            {clinicName ?? clinicSlug}
          </div>
        </header>
      )}
      <main
        className="relative z-10 mx-auto w-full max-w-[430px] px-4 pt-4"
        style={{
          paddingBottom: showTabBar
            ? `calc(${TABBAR_OFFSET} + 2rem)`
            : "6rem",
        }}
      >
        {state.status === "ready" ? <FamilySwitcher /> : null}
        {children}
      </main>
      {showTabBar ? (
        <MiniAppTabBar
          base={base}
          pathname={pathname}
          botUsername={clinic?.tgBotUsername ?? null}
        />
      ) : null}
    </div>
  );
}

type TabIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;
type TabItem = { label: string; icon: TabIcon } & (
  | { href: string; exact?: boolean }
  | { onClick: () => void }
);

function MiniAppTabBar({
  base,
  pathname,
  botUsername,
}: {
  base: string;
  pathname: string;
  botUsername: string | null;
}) {
  const t = useT();
  const tg = useTelegramWebApp();

  // Chat is handled by the clinic's Telegram bot, not an in-app thread — the
  // tab opens the bot chat so replies land where staff actually watch them.
  const openBot = React.useCallback(() => {
    tg.haptic.selection();
    if (!botUsername) return;
    const url = `https://t.me/${botUsername}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      try {
        window.Telegram.WebApp.openTelegramLink(url);
        return;
      } catch {
        // fall through to a plain navigation
      }
    }
    window.open(url, "_blank");
  }, [tg, botUsername]);

  const tabs: TabItem[] = [
    { href: base, label: t.tabs.home, icon: Home, exact: true },
    {
      href: `${base}/appointments`,
      label: t.tabs.appointments,
      icon: CalendarDays,
    },
    { onClick: openBot, label: t.tabs.chat, icon: MessageCircle },
    { href: `${base}/profile`, label: t.tabs.profile, icon: UserRound },
  ];
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30"
      style={{
        backgroundColor: "color-mix(in oklch, var(--tg-bg) 86%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop:
          "1px solid color-mix(in oklch, var(--tg-hint) 16%, transparent)",
        paddingBottom: "max(env(safe-area-inset-bottom), 0.5rem)",
      }}
    >
      <div className="mx-auto grid h-[3.75rem] max-w-[430px] grid-cols-4 px-2">
        {tabs.map((tab) => {
          const { label, icon: Icon } = tab;
          const isLink = "href" in tab;
          const active = isLink
            ? tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href)
            : false;
          const className = "flex flex-col items-center justify-center gap-0.5";
          const style: React.CSSProperties = {
            color: active ? "var(--tg-accent)" : "var(--tg-hint)",
            transition: "color .2s ease",
          };
          const inner = (
            <>
              <span
                className="flex h-7 w-12 items-center justify-center rounded-full"
                style={{
                  backgroundColor: active
                    ? "color-mix(in oklch, var(--tg-accent) 14%, transparent)"
                    : "transparent",
                  transition: "background-color .2s ease",
                }}
              >
                <Icon
                  className="h-[22px] w-[22px]"
                  strokeWidth={active ? 2.2 : 1.8}
                />
              </span>
              <span className="text-[10px] font-semibold leading-none">
                {label}
              </span>
            </>
          );
          if (isLink) {
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => {
                  if (!active) tg.haptic.selection();
                }}
                className={className}
                style={style}
              >
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={label}
              type="button"
              onClick={tab.onClick}
              className={className}
              style={style}
            >
              {inner}
            </button>
          );
        })}
      </div>
    </nav>
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
        animation: ma-fade-up .32s cubic-bezier(.2,.8,.2,1) both;
      }
      .ma-step-enter {
        animation: ma-step-enter .36s cubic-bezier(.2,.8,.2,1) both;
      }
      /* Touch feedback: press snaps instantly (~1 frame), release eases out.
         Pair with Tailwind active:scale-* — this only owns the timing. */
      .ma-press {
        transition: transform .18s cubic-bezier(.2,.8,.2,1), opacity .15s ease,
          background-color .15s ease, color .15s ease, border-color .15s ease;
      }
      .ma-press:active {
        transition-duration: .06s;
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
      @keyframes ma-ping {
        0%        { transform: scale(1); opacity: .65; }
        80%, 100% { transform: scale(2.6); opacity: 0; }
      }
      .ma-ping {
        animation: ma-ping 1.8s cubic-bezier(0, 0, .2, 1) infinite;
      }
      @keyframes ma-nudge-up {
        0%, 100% { transform: translateY(0); opacity: .7; }
        50%      { transform: translateY(-3px); opacity: 1; }
      }
      .ma-nudge-up {
        animation: ma-nudge-up 1.8s ease-in-out infinite;
      }
      .ma-paused .ma-aurora {
        animation-play-state: paused;
      }
      @media (prefers-reduced-motion: reduce) {
        .ma-aurora-a, .ma-aurora-b, .ma-aurora-c,
        .ma-fade-up, .ma-step-enter, .ma-skeleton, .ma-fade-in,
        .ma-sheet-in, .ma-sheet-out, .ma-backdrop-in, .ma-backdrop-out,
        .ma-toast-out, .ma-check-pop, .ma-draw, .ma-ring, .ma-ping,
        .ma-nudge-up {
          animation: none !important;
        }
        .ma-draw {
          stroke-dashoffset: 0;
        }
        .ma-press {
          transition: none !important;
        }
      }
    `}</style>
  );
}
