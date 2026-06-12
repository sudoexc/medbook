"use client";

/**
 * Phase M4 — Toast / popup system for the Mini App.
 *
 * Three layers, picked at call-site by what the TG WebApp client supports:
 *
 *   1. TG 6.2+ — `Telegram.WebApp.showPopup({ message, buttons })` for
 *      `error` level (the dedicated dialog has the correct icon + button
 *      semantics on every platform). Wrapped in `usePopup` for callers that
 *      want a confirm-style dialog.
 *   2. TG 6.1+ — `HapticFeedback.notificationOccurred(level)` always fires
 *      so the patient feels success/error even when they're not looking at
 *      the popup.
 *   3. Older TG / outside-TG fallback — inline custom toast pinned to the
 *      bottom edge of the viewport. Auto-dismisses after 3s; tapping it
 *      dismisses early.
 *
 * `useShowToast()` returns the imperative `(level, message)` function the
 * mutation hooks already call. Mount `<MiniAppToastViewport />` once near
 * the bottom of the shell so fallback toasts have a host.
 */
import * as React from "react";

export type ToastLevel = "info" | "success" | "error";

export type ToastEntry = {
  id: string;
  level: ToastLevel;
  message: string;
  /** Exit animation is playing; the entry unmounts ~220ms later. */
  leaving?: boolean;
};

type ToastContextValue = {
  push: (level: ToastLevel, message: string) => void;
  entries: ReadonlyArray<ToastEntry>;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DISMISS_AFTER_MS = 3200;
const MAX_VISIBLE = 3;

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `t_${Date.now().toString(36)}_${idSeq.toString(36)}`;
}

export function MiniAppToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = React.useState<ToastEntry[]>([]);
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const remove = React.useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  // Two-phase dismiss: flag the entry as leaving so the exit animation
  // plays, then actually remove it once the animation has finished.
  const dismiss = React.useCallback(
    (id: string) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, leaving: true } : e)),
      );
      const t = timers.current.get(id);
      if (t) clearTimeout(t);
      timers.current.set(
        id,
        setTimeout(() => remove(id), 220),
      );
    },
    [remove],
  );

  const push = React.useCallback<ToastContextValue["push"]>(
    (level, message) => {
      // Always fire haptics so the patient feels feedback even when the
      // popup pathway is silenced (older clients without HapticFeedback API
      // simply no-op).
      try {
        const fb = window.Telegram?.WebApp?.HapticFeedback;
        if (level === "error") fb?.notificationOccurred?.("error");
        else if (level === "success") fb?.notificationOccurred?.("success");
        else fb?.impactOccurred?.("light");
      } catch {
        /* ignore */
      }

      // Errors get a native TG popup when available — modal, screen reader-
      // friendly, dismisses with the system "OK" button.
      const tg = window.Telegram?.WebApp;
      if (level === "error" && tg && typeof tg.showAlert === "function") {
        try {
          tg.showAlert(message);
          return; // No inline toast needed; the modal already informs.
        } catch {
          /* fall through to fallback */
        }
      }

      const id = nextId();
      setEntries((prev) => {
        const next = [...prev, { id, level, message }];
        return next.slice(-MAX_VISIBLE);
      });
      const handle = setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
      timers.current.set(id, handle);
    },
    [dismiss],
  );

  // Cleanup on unmount: prevent setState-after-unmount warnings during
  // hot reload / route changes.
  React.useEffect(() => {
    const tmap = timers.current;
    return () => {
      for (const t of tmap.values()) clearTimeout(t);
      tmap.clear();
    };
  }, []);

  const value = React.useMemo<ToastContextValue>(
    () => ({ push, entries, dismiss }),
    [push, entries, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <MiniAppToastViewport />
    </ToastContext.Provider>
  );
}

export function useShowToast(): (level: ToastLevel, message: string) => void {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Outside the provider — still safe to call. Falls back to console
    // so failure cases during boot don't crash the page.
    return (level, message) => {
      console[level === "error" ? "error" : "log"]("[miniapp:toast]", message);
    };
  }
  return ctx.push;
}

function MiniAppToastViewport(): React.ReactElement | null {
  const ctx = React.useContext(ToastContext);
  if (!ctx || ctx.entries.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
      style={{
        // --ma-tabbar-offset is set on <html> by the shell (this viewport
        // portals outside the shell subtree); 0px when the bar is hidden.
        bottom:
          "calc(var(--ma-tabbar-offset, 0px) + max(env(safe-area-inset-bottom), 1.25rem))",
      }}
    >
      {ctx.entries.map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={() => ctx.dismiss(e.id)}
          className={`${e.leaving ? "ma-toast-out" : "ma-fade-up"} pointer-events-auto w-full max-w-[28rem] rounded-2xl px-4 py-3 text-sm font-medium shadow-lg`}
          style={{
            backgroundColor:
              e.level === "error"
                ? "#dc2626"
                : e.level === "success"
                  ? "#16a34a"
                  : "var(--tg-section-bg)",
            color: e.level === "info" ? "var(--tg-text)" : "#fff",
            border:
              e.level === "info"
                ? "1px solid color-mix(in oklch, var(--tg-hint) 22%, transparent)"
                : "none",
          }}
        >
          {e.message}
        </button>
      ))}
    </div>
  );
}
