"use client";

/**
 * Dev-only translation wrapper that surfaces missing i18n keys instead of
 * silently rendering the key path (next-intl default fallback).
 *
 * Usage:
 *   import { useT } from "@/components/dev/missing-key-warner";
 *   const t = useT("docsLibrary");
 *   <span>{t("title")}</span>
 *
 * In `process.env.NODE_ENV !== "production"`, missing keys render as
 * `[MISSING: <namespace>.<key>]` so they jump out during dev. In production,
 * we delegate to next-intl's standard fallback (returns the key path) and
 * never display the marker — silent fallback is the existing behaviour and we
 * don't want this dev hint to leak into shipped UI.
 *
 * Existing `useTranslations` call sites are NOT modified; this is opt-in.
 */
import type * as React from "react";
import { useMessages, useTranslations } from "next-intl";

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * Walk a flat dot-path through a nested message object. Returns the value if
 * found, otherwise undefined. Treats only string leaves as a "hit" — nested
 * objects are not directly renderable.
 */
function lookupKey(
  messages: Record<string, unknown> | undefined,
  fullPath: string,
): unknown {
  if (!messages) return undefined;
  const parts = fullPath.split(".");
  let cursor: unknown = messages;
  for (const p of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[p];
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

export type Translator = (key: string, values?: Record<string, unknown>) => string;

/**
 * Drop-in replacement for next-intl's `useTranslations(namespace)` that adds
 * a dev-mode missing-key marker. Note: only basic `t(key, values?)` form is
 * supported — features like `t.rich`, `t.markup`, ICU plural with React
 * elements should keep using the original `useTranslations` directly.
 */
export function useT(namespace?: string): Translator {
  const baseT = useTranslations(namespace);
  const messages = useMessages() as Record<string, unknown> | undefined;

  if (!IS_DEV) {
    // Production: delegate as-is. next-intl's default missing-key behaviour
    // is preserved — silent fallback / error handler.
    return ((key: string, values?: Record<string, unknown>) =>
      baseT(key, values as never)) as Translator;
  }

  // Dev: pre-check key existence in the loaded message bundle. If absent,
  // return a visible marker without invoking baseT (which would log a
  // MISSING_MESSAGE error and return the key path).
  return ((key: string, values?: Record<string, unknown>) => {
    const fullPath = namespace ? `${namespace}.${key}` : key;
    const found = lookupKey(messages, fullPath);
    if (typeof found !== "string") {
      return `[MISSING: ${fullPath}]`;
    }
    return baseT(key, values as never);
  }) as Translator;
}

/**
 * React component variant — handy in places where you don't want to refactor
 * to a hook. Renders the translated string or a `[MISSING: ...]` marker in
 * dev. Production always delegates to next-intl.
 *
 *   <T ns="docsLibrary" k="title" />
 */
export function T({
  ns,
  k,
  values,
}: {
  ns?: string;
  k: string;
  values?: Record<string, unknown>;
}): React.ReactElement {
  const t = useT(ns);
  return <>{t(k, values)}</>;
}
