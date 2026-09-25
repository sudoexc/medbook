"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useMiniAppAuth } from "../_components/miniapp-auth-provider";
import { useMiniAppFetch } from "./use-miniapp-api";
import type { MiniAppProfile } from "./use-profile";

/**
 * «Confirm my number» (audit PH-01).
 *
 * A number typed into the Mini App proves nothing, so the Mini App no longer
 * accepts one. Instead `Telegram.WebApp.requestContact()` asks Telegram to
 * post the account's OWN contact into the bot chat; the bot webhook checks
 * `contact.user_id === from.id` and records the number as verified. That
 * happens server-side and asynchronously, so this hook polls the profile
 * until the verified number appears.
 *
 * When the number turns out to be the identity of the card the clinic
 * already keeps for this patient, the webhook moves the Telegram account to
 * that card (MA-04): the profile then answers with a different id, and the
 * whole Mini App re-authenticates to show the card with its history.
 */
export type ShareContactStatus =
  | "idle"
  | "asking"
  | "waiting"
  | "done"
  | "failed"
  | "unsupported";

const POLL_INTERVAL_MS = 1500;
const POLL_ATTEMPTS = 10;

export function useShareContact() {
  const tg = useTelegramWebApp();
  const qc = useQueryClient();
  const { request } = useMiniAppFetch();
  const { state, updatePatient, refresh } = useMiniAppAuth();
  const [status, setStatus] = React.useState<ShareContactStatus>("idle");

  // The poll outlives renders; read the current card id through refs.
  const currentId = state.status === "ready" ? state.patient.id : null;
  const patientIdRef = React.useRef<string | null>(currentId);
  const requestRef = React.useRef(request);
  React.useEffect(() => {
    patientIdRef.current = currentId;
    requestRef.current = request;
  });
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const poll = React.useCallback(async () => {
    for (let i = 0; i < POLL_ATTEMPTS; i += 1) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!alive.current) return;
      let profile: MiniAppProfile | null = null;
      try {
        profile = (
          await requestRef.current<{ patient: MiniAppProfile }>(
            "/api/miniapp/profile",
          )
        ).patient;
      } catch {
        continue;
      }
      if (!profile.phoneVerified) continue;
      if (profile.id !== patientIdRef.current) {
        // The account now opens the clinic's own card: reload everything.
        await refresh();
        await qc.invalidateQueries({ queryKey: ["miniapp"] });
      } else {
        updatePatient({
          phone: profile.phone,
          hasPhone: profile.hasPhone,
          phoneVerified: true,
        });
        await qc.invalidateQueries({ queryKey: ["miniapp", "profile"] });
      }
      if (alive.current) setStatus("done");
      return;
    }
    if (alive.current) setStatus("failed");
  }, [qc, refresh, updatePatient]);

  const start = React.useCallback(() => {
    const webApp = tg.tg;
    if (!webApp?.requestContact) {
      setStatus("unsupported");
      return;
    }
    setStatus("asking");
    try {
      webApp.requestContact((shared) => {
        if (!shared) {
          setStatus("idle");
          return;
        }
        setStatus("waiting");
        void poll();
      });
    } catch {
      setStatus("unsupported");
    }
  }, [tg.tg, poll]);

  return { status, start };
}
