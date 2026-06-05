"use client";

import * as React from "react";
import { Clock, MapPin, Phone, Mail } from "lucide-react";

import { formatPhone } from "@/lib/format";
import { useClinic } from "../_hooks/use-clinic";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useT, useLang } from "./mini-i18n";

/**
 * Compact clinic contact card. Surfaces address + phone + working hours so the
 * patient doesn't have to leave the Mini App to reach the clinic. tg.openLink
 * is preferred for tel:/mailto:/maps so Telegram routes through its browser
 * shim — falling back to a plain <a> when the WebApp SDK isn't ready (dev).
 */
export function ClinicInfoCard({ slug }: { slug: string }) {
  const t = useT();
  const lang = useLang();
  const tg = useTelegramWebApp();
  const { state } = useMiniAppAuth();
  const { data: clinic } = useClinic(slug);

  if (!clinic) return null;

  const address = lang === "UZ" ? clinic.addressUz ?? clinic.addressRu : clinic.addressRu;
  const clinicName = lang === "UZ" ? clinic.nameUz ?? clinic.nameRu : clinic.nameRu;
  const phone = clinic.phone;
  const email = clinic.email;
  const hours = clinic.workdayStart && clinic.workdayEnd
    ? `${clinic.workdayStart}–${clinic.workdayEnd}`
    : null;

  const open = React.useCallback(
    (href: string) => {
      // Telegram's WebApp routes tel:/mailto:/https links through the host so
      // they work even when the in-app webview blocks naked anchors.
      if (typeof window !== "undefined" && window.Telegram?.WebApp?.openLink) {
        try {
          window.Telegram.WebApp.openLink(href);
          tg.haptic.impact("light");
          return;
        } catch {
          // fall through to anchor
        }
      }
      window.location.href = href;
    },
    [tg],
  );

  const onCall = phone
    ? () => open(`tel:${phone.replace(/\s+/g, "")}`)
    : undefined;
  const onEmail = email ? () => open(`mailto:${email}`) : undefined;
  const onRoute = address
    ? () =>
        open(
          `https://yandex.com/maps/?text=${encodeURIComponent(`${clinicName}, ${address}`)}`,
        )
    : undefined;

  // Hide the card entirely when nothing to show (anonymous error states etc).
  if (!address && !phone && !email && !hours) return null;
  // Defer mounting until the auth resolves so we don't render an awkward
  // half-card during the initial spinner phase on home.
  if (state.status !== "ready") return null;

  return (
    <div
      className="ma-fade-up mb-5"
      style={{ animationDelay: "30ms" }}
    >
      <div
        className="text-xs font-semibold uppercase tracking-wide mb-2 px-1"
        style={{ color: "var(--tg-hint)" }}
      >
        {t.clinicCard.header}
      </div>
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{
          backgroundColor: "var(--tg-section-bg)",
          color: "var(--tg-text)",
          boxShadow:
            "0 1px 2px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.05)",
        }}
      >
        {address ? (
          <Row
            icon={MapPin}
            label={t.clinicCard.addressLabel}
            value={address}
          />
        ) : null}
        {phone ? (
          <Row
            icon={Phone}
            label={t.clinicCard.phoneLabel}
            value={formatPhone(phone)}
          />
        ) : null}
        {hours ? (
          <Row
            icon={Clock}
            label={t.clinicCard.hoursLabel}
            value={`${hours} · ${t.clinicCard.hoursDaily}`}
          />
        ) : null}
        {(onCall || onRoute || onEmail) ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {onCall ? (
              <ActionPill icon={Phone} label={t.clinicCard.callCta} onClick={onCall} />
            ) : null}
            {onRoute ? (
              <ActionPill icon={MapPin} label={t.clinicCard.routeCta} onClick={onRoute} />
            ) : null}
            {onEmail ? (
              <ActionPill icon={Mail} label={t.clinicCard.emailCta} onClick={onEmail} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="mt-0.5 shrink-0"
        style={{ color: "var(--tg-accent)" }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
          {label}
        </div>
        <div className="text-sm font-medium leading-snug">{value}</div>
      </div>
    </div>
  );
}

function ActionPill({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition active:scale-95"
      style={{
        borderColor: "color-mix(in oklch, var(--tg-accent) 35%, transparent)",
        color: "var(--tg-accent)",
        backgroundColor: "color-mix(in oklch, var(--tg-accent) 8%, transparent)",
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
