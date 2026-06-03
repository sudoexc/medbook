"use client";

/**
 * Phase M4 — Mini App error boundary.
 *
 * Wraps the entire mini-app subtree. A render error inside a child:
 *   1. Triggers a TG haptic `error` notification (when available).
 *   2. Posts `{ message, stack, componentStack, location }` to
 *      `/api/miniapp/client-errors` so we can correlate JS errors with the
 *      patient + clinic (the endpoint reads the init-data header and stamps
 *      the row server-side).
 *   3. Renders a TG-native popup ("Что-то сломалось. Перезагрузить?") and a
 *      fallback UI with a "Перезагрузить" button.
 *
 * Why a class component: `componentDidCatch` only exists on class components
 * in React 19. Function-based error boundaries via `error.tsx` work for
 * Next.js page-level errors but don't catch render errors thrown deeper in
 * a client subtree.
 *
 * The boundary is wrapped *inside* `QueryProvider` and *outside*
 * `MiniAppAuthProvider` so it can still render when auth itself crashes.
 */
import * as React from "react";

import { miniAppFetchHeaders } from "./miniapp-auth-provider";

type ErrorContext = {
  initData?: string;
  isTelegramContext?: boolean;
  clinicSlug?: string;
};

type Props = {
  children: React.ReactNode;
  /** Provided by the parent so we can attach clinic/init-data to reports. */
  context?: ErrorContext;
};

type State = {
  hasError: boolean;
  message: string;
};

export class MiniAppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    return { hasError: true, message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Fire-and-forget report. We never await — the boundary must keep
    // rendering even when the network is down.
    this.report(error, info);
    try {
      // TG haptic error feedback when available.
      window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.("error");
    } catch {
      /* ignore */
    }
  }

  private async report(error: Error, info: React.ErrorInfo): Promise<void> {
    if (typeof window === "undefined") return;
    const { context } = this.props;
    const payload = {
      message: error.message,
      stack: error.stack ?? null,
      componentStack: info.componentStack ?? null,
      location:
        typeof window.location !== "undefined" ? window.location.href : null,
      userAgent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
      clinicSlug: context?.clinicSlug ?? null,
      at: new Date().toISOString(),
    };
    try {
      await fetch("/api/miniapp/client-errors", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(context?.initData
            ? miniAppFetchHeaders(
                context.initData,
                context.isTelegramContext ?? false,
              )
            : {}),
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch {
      // Best-effort — we already rendered the fallback.
    }
  }

  private handleReload = () => {
    try {
      window.Telegram?.WebApp?.HapticFeedback?.impactOccurred?.("light");
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="flex max-w-sm flex-col items-center gap-4">
          <div className="text-5xl" aria-hidden>
            ⚠️
          </div>
          <div className="text-base font-semibold">Что-то сломалось</div>
          <div className="text-sm opacity-70">
            Перезагрузите экран — это обычно помогает. Мы уже знаем о проблеме.
          </div>
          <button
            type="button"
            onClick={this.handleReload}
            className="rounded-full px-6 py-2 text-sm font-semibold"
            style={{
              backgroundColor: "var(--tg-accent, #2353FF)",
              color: "#fff",
            }}
          >
            Перезагрузить
          </button>
          <div className="text-xs opacity-50">{this.state.message}</div>
        </div>
      </div>
    );
  }
}
