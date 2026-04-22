"use client";

/**
 * Dead-simple i18n for the Mini App. We do not pass through next-intl
 * because the Mini App lives outside the locale-prefixed tree and we want
 * the language to come from `Patient.preferredLang` (set in the profile) —
 * not from the URL.
 */
import { useMemo } from "react";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { ruDict } from "../_messages/ru";
import { uzDict } from "../_messages/uz";

export type Dict = typeof ruDict;

export function useLang(): "RU" | "UZ" {
  const { state } = useMiniAppAuth();
  return state.status === "ready" ? state.patient.preferredLang : "RU";
}

export function useT(): Dict {
  const lang = useLang();
  return useMemo<Dict>(() => (lang === "UZ" ? uzDict : ruDict), [lang]);
}
