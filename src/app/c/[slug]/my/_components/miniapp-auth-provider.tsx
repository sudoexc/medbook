"use client";

import * as React from "react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export type MiniAppPatient = {
  id: string;
  fullName: string;
  phone: string;
  preferredLang: "RU" | "UZ";
  telegramId: string | null;
  telegramUsername: string | null;
  hasPhone: boolean;
};

export type MiniAppClinic = {
  id: string;
  slug: string;
};

type AuthState =
  | { status: "loading" }
  | { status: "no_tg" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      patient: MiniAppPatient;
      clinic: MiniAppClinic;
    };

type MiniAppAuthContextValue = {
  state: AuthState;
  clinicSlug: string;
  refresh: () => Promise<void>;
  updatePatient: (patch: Partial<MiniAppPatient>) => void;
  initData: string;
  isTelegramContext: boolean;
};

const MiniAppAuthContext = React.createContext<MiniAppAuthContextValue | null>(
  null,
);

export function useMiniAppAuth(): MiniAppAuthContextValue {
  const ctx = React.useContext(MiniAppAuthContext);
  if (!ctx) {
    throw new Error(
      "useMiniAppAuth must be used inside <MiniAppAuthProvider>",
    );
  }
  return ctx;
}

/**
 * Exchanges the TG init-data for a server-verified Mini App session. Renders
 * a "Open in Telegram" fallback when not in the TG WebApp context.
 */
export function MiniAppAuthProvider({
  clinicSlug,
  children,
}: {
  clinicSlug: string;
  children: React.ReactNode;
}) {
  const { initData, isTelegramContext, ready } = useTelegramWebApp();
  const [state, setState] = React.useState<AuthState>({ status: "loading" });

  const authenticate = React.useCallback(async () => {
    setState({ status: "loading" });
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-telegram-init-data": initData,
      };
      // Dev-only bypass when not in Telegram — lets us preview the Mini App
      // in a normal browser. The server refuses this header in production.
      if (!isTelegramContext && typeof window !== "undefined") {
        headers["x-miniapp-dev-bypass"] = "1";
        headers["x-miniapp-dev-user"] = JSON.stringify({
          id: 99999,
          first_name: "Dev",
          last_name: "User",
          username: "dev_miniapp",
          language_code: "ru",
        });
      }
      const res = await fetch(
        `/api/miniapp/auth?clinicSlug=${encodeURIComponent(clinicSlug)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({}),
          cache: "no-store",
        },
      );
      if (!res.ok) {
        if (res.status === 401 && !isTelegramContext) {
          setState({ status: "no_tg" });
          return;
        }
        const body = await res.json().catch(() => ({}));
        setState({
          status: "error",
          message: body?.reason ?? body?.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as {
        patient: MiniAppPatient;
        clinic: MiniAppClinic;
      };
      setState({ status: "ready", patient: data.patient, clinic: data.clinic });
    } catch (e) {
      setState({ status: "error", message: (e as Error).message });
    }
  }, [clinicSlug, initData, isTelegramContext]);

  React.useEffect(() => {
    if (!ready) return;
    // Only attempt once we know whether we're inside TG or not.
    authenticate();
  }, [ready, authenticate]);

  const updatePatient = React.useCallback((patch: Partial<MiniAppPatient>) => {
    setState((prev) => {
      if (prev.status !== "ready") return prev;
      return { ...prev, patient: { ...prev.patient, ...patch } };
    });
  }, []);

  const value = React.useMemo<MiniAppAuthContextValue>(
    () => ({
      state,
      clinicSlug,
      refresh: authenticate,
      updatePatient,
      initData,
      isTelegramContext,
    }),
    [state, clinicSlug, authenticate, updatePatient, initData, isTelegramContext],
  );

  return (
    <MiniAppAuthContext.Provider value={value}>
      {children}
    </MiniAppAuthContext.Provider>
  );
}

/**
 * Convenience: build the fetch headers the Mini App uses for every API call.
 */
export function miniAppFetchHeaders(initData: string, isTelegram: boolean): HeadersInit {
  const h: Record<string, string> = {
    "content-type": "application/json",
    "x-telegram-init-data": initData,
  };
  if (!isTelegram && typeof window !== "undefined") {
    h["x-miniapp-dev-bypass"] = "1";
    h["x-miniapp-dev-user"] = JSON.stringify({
      id: 99999,
      first_name: "Dev",
      last_name: "User",
      username: "dev_miniapp",
      language_code: "ru",
    });
  }
  return h;
}
