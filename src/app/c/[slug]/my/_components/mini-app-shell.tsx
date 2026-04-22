"use client";

import * as React from "react";

import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useClinic } from "../_hooks/use-clinic";

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
  const { themeParams, colorScheme } = useTelegramWebApp();
  const { state } = useMiniAppAuth();
  const { data: clinic } = useClinic(clinicSlug);

  const bg = themeParams.bg_color ?? (colorScheme === "dark" ? "#17212b" : "#f4f4f5");
  const text = themeParams.text_color ?? (colorScheme === "dark" ? "#f5f5f5" : "#0a0a0a");
  const hint = themeParams.hint_color ?? "#8f9ba7";
  const sectionBg =
    themeParams.section_bg_color ??
    (colorScheme === "dark" ? "#232e3c" : "#ffffff");
  const accent = themeParams.button_color ?? "#3DD5C0";

  const lang =
    state.status === "ready"
      ? state.patient.preferredLang.toLowerCase()
      : "ru";
  const clinicName =
    lang === "uz" ? clinic?.nameUz ?? clinic?.nameRu : clinic?.nameRu;

  return (
    <div
      className="min-h-dvh w-full antialiased"
      style={
        {
          backgroundColor: bg,
          color: text,
          // Expose theme colours to child CSS.
          "--tg-bg": bg,
          "--tg-text": text,
          "--tg-hint": hint,
          "--tg-section-bg": sectionBg,
          "--tg-accent": accent,
        } as React.CSSProperties
      }
    >
      <header
        className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: sectionBg, borderBottom: `1px solid ${hint}22` }}
      >
        {clinic?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clinic.logoUrl}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
        ) : (
          <div
            className="grid h-9 w-9 place-items-center rounded-full text-sm font-semibold"
            style={{ backgroundColor: accent, color: "#fff" }}
          >
            {clinicName?.slice(0, 1) ?? "C"}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">
            {clinicName ?? clinicSlug}
          </div>
          {clinic?.addressRu ? (
            <div className="truncate text-xs" style={{ color: hint }}>
              {lang === "uz" ? clinic.addressUz ?? clinic.addressRu : clinic.addressRu}
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[430px] px-4 pb-24 pt-4">{children}</main>
    </div>
  );
}
