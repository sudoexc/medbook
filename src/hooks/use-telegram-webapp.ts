"use client";

/**
 * SSR-safe wrapper around `window.Telegram.WebApp`.
 *
 * Outside of Telegram (regular browser), every field is `null`/no-op so the
 * calling UI can still render (with an "Open in Telegram" fallback banner).
 *
 * Docs: https://core.telegram.org/bots/webapps
 */
import * as React from "react";

export type TgThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  section_header_text_color?: string;
  subtitle_text_color?: string;
  destructive_text_color?: string;
};

export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
};

type TgMainButton = {
  text: string;
  show: () => void;
  hide: () => void;
  setText: (text: string) => void;
  enable: () => void;
  disable: () => void;
  showProgress: (leaveActive?: boolean) => void;
  hideProgress: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
  setParams: (p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) => void;
};

type TgBackButton = {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (cb: () => void) => void;
  offClick: (cb: () => void) => void;
};

type TgHapticFeedback = {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
  selectionChanged: () => void;
};

export type TgWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: TgUser;
    query_id?: string;
    start_param?: string;
    auth_date?: number;
    hash?: string;
  };
  colorScheme: "light" | "dark";
  themeParams: TgThemeParams;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  // Bot API 8.0+ — true fullscreen (hides system status bar). No-op on
  // older clients; we call it defensively and swallow errors.
  requestFullscreen?: () => void;
  MainButton: TgMainButton;
  BackButton: TgBackButton;
  HapticFeedback: TgHapticFeedback;
  showAlert: (message: string, cb?: () => void) => void;
  showConfirm: (message: string, cb?: (ok: boolean) => void) => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  requestContact?: (cb?: (ok: boolean) => void) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TgWebApp;
    };
  }
}

function getTg(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export type UseTelegramWebAppResult = {
  ready: boolean;
  isTelegramContext: boolean;
  initData: string;
  initDataUnsafe: TgWebApp["initDataUnsafe"];
  user: TgUser | null;
  themeParams: TgThemeParams;
  colorScheme: "light" | "dark";
  tg: TgWebApp | null;
  showAlert: (msg: string) => void;
  showConfirm: (msg: string) => Promise<boolean>;
  haptic: {
    impact: (style?: "light" | "medium" | "heavy") => void;
    notification: (type: "error" | "success" | "warning") => void;
    selection: () => void;
  };
  setMainButton: (opts: {
    text?: string;
    onClick?: () => void;
    visible?: boolean;
    active?: boolean;
    progress?: boolean;
  }) => () => void;
  setBackButton: (onClick?: () => void) => () => void;
};

/**
 * Loads the Telegram WebApp script (if present in `window.Telegram`) and
 * exposes a typed interface. When not inside Telegram (regular browser), all
 * methods become no-ops and `isTelegramContext` is `false`.
 */
export function useTelegramWebApp(): UseTelegramWebAppResult {
  const [ready, setReady] = React.useState(false);
  const [tg, setTg] = React.useState<TgWebApp | null>(null);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    // Inject the SDK script if missing (e.g. dev preview in a browser),
    // then give it up to ~2.4s to initialize — beyond that we just render the
    // "Open in Telegram" fallback.
    if (!window.Telegram && !document.querySelector("script[data-tg-sdk]")) {
      const s = document.createElement("script");
      s.src = "https://telegram.org/js/telegram-web-app.js";
      s.async = true;
      s.dataset.tgSdk = "1";
      document.head.appendChild(s);
    }
    let attempts = 0;
    const tick = () => {
      const w = getTg();
      if (w) {
        if (!cancelled) {
          w.ready();
          try {
            w.expand();
          } catch {
            /* ignore */
          }
          try {
            w.requestFullscreen?.();
          } catch {
            /* ignore */
          }
          setTg(w);
          setReady(true);
        }
        return;
      }
      if (attempts++ > 20) {
        // Give up; render fallback shell.
        if (!cancelled) setReady(true);
        return;
      }
      setTimeout(tick, 120);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMainButton = React.useCallback<UseTelegramWebAppResult["setMainButton"]>(
    (opts) => {
      if (!tg) return () => {};
      const mb = tg.MainButton;
      if (opts.text !== undefined) mb.setText(opts.text);
      if (opts.active !== undefined) {
        if (opts.active) mb.enable();
        else mb.disable();
      }
      if (opts.progress) mb.showProgress(true);
      else mb.hideProgress();
      let offCb: (() => void) | null = null;
      if (opts.onClick) {
        offCb = opts.onClick;
        mb.onClick(opts.onClick);
      }
      if (opts.visible ?? true) mb.show();
      else mb.hide();
      return () => {
        if (offCb) mb.offClick(offCb);
        mb.hideProgress();
        mb.hide();
      };
    },
    [tg],
  );

  const setBackButton = React.useCallback<UseTelegramWebAppResult["setBackButton"]>(
    (onClick) => {
      if (!tg) return () => {};
      if (!onClick) {
        tg.BackButton.hide();
        return () => {};
      }
      tg.BackButton.onClick(onClick);
      tg.BackButton.show();
      return () => {
        tg.BackButton.offClick(onClick);
        tg.BackButton.hide();
      };
    },
    [tg],
  );

  const showAlert = React.useCallback(
    (msg: string) => {
      if (tg?.showAlert) tg.showAlert(msg);
      else if (typeof window !== "undefined") window.alert(msg);
    },
    [tg],
  );
  const showConfirm = React.useCallback(
    (msg: string) =>
      new Promise<boolean>((resolve) => {
        if (tg?.showConfirm) tg.showConfirm(msg, (ok) => resolve(!!ok));
        else if (typeof window !== "undefined") resolve(window.confirm(msg));
        else resolve(false);
      }),
    [tg],
  );
  const haptic = React.useMemo(
    () => ({
      impact: (style: "light" | "medium" | "heavy" = "medium") =>
        tg?.HapticFeedback?.impactOccurred?.(style),
      notification: (type: "error" | "success" | "warning") =>
        tg?.HapticFeedback?.notificationOccurred?.(type),
      selection: () => tg?.HapticFeedback?.selectionChanged?.(),
    }),
    [tg],
  );

  return {
    ready,
    isTelegramContext: !!tg,
    initData: tg?.initData ?? "",
    initDataUnsafe: tg?.initDataUnsafe ?? {},
    user: tg?.initDataUnsafe?.user ?? null,
    themeParams: tg?.themeParams ?? {},
    colorScheme: tg?.colorScheme ?? "light",
    tg,
    showAlert,
    showConfirm,
    haptic,
    setMainButton,
    setBackButton,
  };
}
