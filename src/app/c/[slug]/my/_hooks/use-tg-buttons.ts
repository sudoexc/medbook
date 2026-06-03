"use client";

/**
 * Phase M4 — Hook-style wrappers around Telegram WebApp surface APIs.
 *
 * `useTelegramWebApp()` exposes imperative `setMainButton` / `setBackButton`
 * functions, but most call sites want declarative React hooks that follow
 * the component lifecycle. This module re-shapes the existing imperative
 * primitives into:
 *
 *   • `useMainButton({ text, onClick, color?, isVisible? })` — mirrors
 *     `Telegram.WebApp.MainButton` state to the bot's persistent UI.
 *   • `useBackButton(onClick?)` — wires `BackButton.onClick` (default
 *     handler: `router.back()`) and hides on unmount.
 *   • `usePopup()` → `{ showAlert, showConfirm }`. Both fall through to
 *     `window.alert/confirm` outside TG so dev preview still works.
 *   • `useScanQR(onResult)` — wraps `Telegram.WebApp.showScanQrPopup`.
 *     Returns a `scan()` trigger; the consumer (e.g. the referral screen)
 *     calls it on button press.
 *   • `useShare({ text, url })` — wraps `switchInlineQuery` so the patient
 *     can forward a referral to a contact.
 *   • `useClosingConfirmation(active)` — toggles the TG "Discard changes?"
 *     prompt while `active === true` (e.g. unsaved profile edits).
 *
 * Outside the TG WebApp every hook becomes a no-op so SSR + dev browsers
 * keep working.
 */
import * as React from "react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

type TgWindow = NonNullable<typeof window.Telegram>["WebApp"];

function getTg(): TgWindow | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export type MainButtonOptions = {
  text: string;
  onClick: () => void;
  color?: string;
  textColor?: string;
  isVisible?: boolean;
  isActive?: boolean;
  isProgress?: boolean;
};

/**
 * Mirror MainButton state declaratively. Re-fires `setParams` whenever any
 * input changes, and tears the button down on unmount so other screens
 * aren't haunted by a leftover button.
 */
export function useMainButton(opts: MainButtonOptions | null): void {
  const { setMainButton } = useTelegramWebApp();

  // Stable ref so consumers can pass inline callbacks without re-rendering
  // the parent every time.
  const cbRef = React.useRef(opts?.onClick);
  React.useEffect(() => {
    cbRef.current = opts?.onClick;
  }, [opts?.onClick]);

  React.useEffect(() => {
    if (!opts) return;
    const tg = getTg();
    if (tg?.MainButton && (opts.color || opts.textColor)) {
      try {
        tg.MainButton.setParams({
          text: opts.text,
          color: opts.color,
          text_color: opts.textColor,
          is_active: opts.isActive ?? true,
          is_visible: opts.isVisible ?? true,
        });
      } catch {
        /* ignore */
      }
    }
    const off = setMainButton({
      text: opts.text,
      onClick: () => cbRef.current?.(),
      visible: opts.isVisible ?? true,
      active: opts.isActive ?? true,
      progress: opts.isProgress ?? false,
    });
    return off;
    // We intentionally exclude `onClick` from deps — the ref shields us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    opts?.text,
    opts?.color,
    opts?.textColor,
    opts?.isVisible,
    opts?.isActive,
    opts?.isProgress,
    setMainButton,
  ]);
}

/**
 * Show the TG BackButton with a handler. Default handler: history.back().
 * Returns void; teardown is automatic.
 */
export function useBackButton(handler?: () => void): void {
  const { setBackButton } = useTelegramWebApp();
  const fnRef = React.useRef(handler);
  React.useEffect(() => {
    fnRef.current = handler;
  }, [handler]);

  React.useEffect(() => {
    const wrapped = () => {
      if (fnRef.current) fnRef.current();
      else if (typeof window !== "undefined") window.history.back();
    };
    const off = setBackButton(wrapped);
    return off;
  }, [setBackButton]);
}

/**
 * Multi-button popup wrapper. Always returns a Promise — the consumer
 * `await`s the chosen button id (or `null` on cancel).
 */
export function usePopup() {
  const { showAlert, showConfirm } = useTelegramWebApp();

  const showPopup = React.useCallback(
    (params: {
      title?: string;
      message: string;
      buttons: Array<{ id: string; type?: "default" | "ok" | "cancel" | "destructive"; text?: string }>;
    }): Promise<string | null> =>
      new Promise((resolve) => {
        const tg = getTg();
        const showPopupFn = (tg as unknown as { showPopup?: (p: unknown, cb: (id: string) => void) => void } | null)?.showPopup;
        if (tg && typeof showPopupFn === "function") {
          try {
            showPopupFn(params, (id: string) => resolve(id ?? null));
            return;
          } catch {
            /* fall through */
          }
        }
        // Fallback: use alert + window.confirm depending on button shape.
        if (params.buttons.length <= 1) {
          showAlert(params.message);
          resolve(params.buttons[0]?.id ?? null);
          return;
        }
        showConfirm(params.message).then((ok) => {
          resolve(
            ok
              ? params.buttons.find((b) => b.type !== "cancel")?.id ?? null
              : params.buttons.find((b) => b.type === "cancel")?.id ?? null,
          );
        });
      }),
    [showAlert, showConfirm],
  );

  return { showAlert, showConfirm, showPopup };
}

/**
 * QR scanner. `scan()` opens the camera; `onResult` receives the decoded
 * text (and may return `true` to close the popup, `false` to keep it open
 * for further scans). Returns a no-op when the host TG version is too old.
 */
export function useScanQR(
  onResult: (text: string) => boolean | void,
  options?: { text?: string },
): { scan: () => void; available: boolean } {
  const cbRef = React.useRef(onResult);
  React.useEffect(() => {
    cbRef.current = onResult;
  }, [onResult]);

  const tgScan = React.useMemo(() => {
    const tg = getTg() as unknown as
      | {
          showScanQrPopup?: (
            params: { text?: string },
            cb: (text: string) => boolean | undefined,
          ) => void;
          closeScanQrPopup?: () => void;
        }
      | null;
    return tg;
  }, []);

  const scan = React.useCallback(() => {
    if (!tgScan?.showScanQrPopup) return;
    try {
      tgScan.showScanQrPopup({ text: options?.text }, (text) => {
        const close = cbRef.current(text);
        return close === false ? false : true;
      });
    } catch {
      /* ignore — old TG client */
    }
  }, [tgScan, options?.text]);

  return { scan, available: typeof tgScan?.showScanQrPopup === "function" };
}

/**
 * Share a referral message via `switchInlineQuery`. Picks the right TG API
 * shape depending on whether the bot supports inline mode.
 */
export function useShare(): {
  shareText: (text: string, chatTypes?: ReadonlyArray<"users" | "bots" | "groups" | "channels">) => void;
  available: boolean;
} {
  const tg = React.useMemo(
    () =>
      getTg() as unknown as
        | {
            switchInlineQuery?: (
              query: string,
              chatTypes?: ReadonlyArray<string>,
            ) => void;
          }
        | null,
    [],
  );
  const shareText = React.useCallback(
    (
      text: string,
      chatTypes: ReadonlyArray<"users" | "bots" | "groups" | "channels"> = [
        "users",
      ],
    ) => {
      if (!tg?.switchInlineQuery) return;
      try {
        tg.switchInlineQuery(text, chatTypes);
      } catch {
        /* ignore */
      }
    },
    [tg],
  );
  return { shareText, available: typeof tg?.switchInlineQuery === "function" };
}

/**
 * Toggle TG's "Discard changes?" prompt. Pass `true` while the form has
 * unsaved input; flip back to `false` when the user saves/cancels.
 */
export function useClosingConfirmation(active: boolean): void {
  React.useEffect(() => {
    const tg = getTg() as unknown as
      | {
          enableClosingConfirmation?: () => void;
          disableClosingConfirmation?: () => void;
        }
      | null;
    if (!tg) return;
    try {
      if (active) tg.enableClosingConfirmation?.();
      else tg.disableClosingConfirmation?.();
    } catch {
      /* ignore */
    }
    return () => {
      try {
        tg?.disableClosingConfirmation?.();
      } catch {
        /* ignore */
      }
    };
  }, [active]);
}
