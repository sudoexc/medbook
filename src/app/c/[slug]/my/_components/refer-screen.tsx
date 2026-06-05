"use client";

/**
 * Phase 16 Wave 3 — Refer-a-friend Mini App screen.
 *
 * Three sections:
 *   1. Hero — the patient's persistent code with copy-to-clipboard CTA
 *      and a Telegram "share" deeplink that prefills the friend's chat
 *      with a localised invite message + the Mini App URL.
 *   2. Pending rewards — discounts already minted (a friend completed a
 *      visit) that will auto-apply on the patient's next booking.
 *   3. Applied / expired history — read-only ledger.
 *
 * The screen does NOT POST anything; opening it is enough to ensure the
 * code exists (server lazy-creates on first GET).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Gift } from "lucide-react";

import { MButton, MCard, MEmpty, MSection, MSpinner } from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { useReferral } from "../_hooks/use-referral";

function buildShareUrl(opts: {
  botUsername: string | null;
  clinicSlug: string;
  code: string;
  message: string;
}): string {
  const { botUsername, clinicSlug, code, message } = opts;
  // Prefer the clinic bot deeplink with a `start` payload carrying the
  // referral code so the bot can apply it on the friend's first visit.
  // Falls back to a plain web URL if the bot username isn't surfaced.
  const target = botUsername
    ? `https://t.me/${botUsername}?start=ref_${encodeURIComponent(code)}`
    : `${typeof window !== "undefined" ? window.location.origin : ""}/c/${clinicSlug}`;
  const params = new URLSearchParams({
    url: target,
    text: message,
  });
  return `https://t.me/share/url?${params.toString()}`;
}

export function ReferScreen() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const query = useReferral();

  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    return tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
  }, [tg, router, clinicSlug]);

  const onCopy = React.useCallback(async () => {
    if (!query.data) return;
    try {
      await navigator.clipboard.writeText(query.data.code);
      setCopied(true);
      tg.haptic.notification("success");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      tg.haptic.notification("error");
    }
  }, [query.data, tg]);

  if (query.isLoading) return <MSpinner label={t.common.loading} />;
  if (query.isError || !query.data) return <MEmpty>{t.common.error}</MEmpty>;

  const data = query.data;
  const inviteText = t.refer.shareText
    .replace("{percent}", String(data.rewardPercent))
    .replace("{code}", data.code);
  const shareUrl = buildShareUrl({
    botUsername: null, // Bot username isn't exposed to the Mini App today
    clinicSlug: data.clinicSlug,
    code: data.code,
    message: inviteText,
  });

  return (
    <div>
      <h1 className="mb-1 text-xl font-bold">{t.refer.title}</h1>
      <p className="mb-4 text-sm" style={{ color: "var(--tg-hint)" }}>
        {t.refer.subtitle.replace("{percent}", String(data.rewardPercent))}
      </p>

      <MCard className="mb-4 space-y-3">
        <div className="text-xs uppercase" style={{ color: "var(--tg-hint)" }}>
          {t.refer.codeLabel}
        </div>
        <div
          className="flex items-center justify-between gap-2 rounded-xl border px-3 py-3"
          style={{
            borderColor:
              "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
            backgroundColor: "var(--tg-bg)",
          }}
        >
          <div
            className="min-w-0 flex-1 truncate font-mono text-xl font-bold tracking-wider"
            style={{ color: "var(--tg-accent)" }}
          >
            {data.code}
          </div>
          <MButton variant="ghost" onClick={onCopy} className="shrink-0">
            {copied ? t.refer.copied : t.refer.copy}
          </MButton>
        </div>
        <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
          {t.refer.useCount.replace("{n}", String(data.useCount))}
        </div>
        <a
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
          className="block"
        >
          <MButton variant="primary" block>
            {t.refer.shareCta}
          </MButton>
        </a>
      </MCard>

      <MSection title={t.refer.pendingTitle}>
        {data.pendingRewards.length === 0 ? (
          <MEmpty icon={Gift}>{t.refer.pendingEmpty}</MEmpty>
        ) : (
          <div className="space-y-2">
            {data.pendingRewards.map((r) => (
              <MCard key={r.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-base font-semibold">
                    −{r.rewardPercent}%
                  </div>
                  <span
                    className="text-xs"
                    style={{ color: "var(--tg-accent)" }}
                  >
                    {t.refer.pendingBadge}
                  </span>
                </div>
                <div className="text-sm" style={{ color: "var(--tg-hint)" }}>
                  {r.friendName ?? t.refer.unknownFriend} ·{" "}
                  {t.refer.expiresAt.replace(
                    "{date}",
                    new Date(r.expiresAt).toLocaleDateString(
                      lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
                      { day: "2-digit", month: "long", year: "numeric" },
                    ),
                  )}
                </div>
              </MCard>
            ))}
          </div>
        )}
      </MSection>

      {data.appliedRewards.length > 0 && (
        <MSection title={t.refer.historyTitle}>
          <div className="space-y-2">
            {data.appliedRewards.map((r) => (
              <MCard key={r.id} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>−{r.rewardPercent}%</span>
                  <span style={{ color: "var(--tg-hint)" }}>
                    {r.appliedAt
                      ? new Date(r.appliedAt).toLocaleDateString(
                          lang === "UZ" ? "uz-Latn-UZ" : "ru-RU",
                          { day: "2-digit", month: "short" },
                        )
                      : "—"}
                  </span>
                </div>
                <div className="text-xs" style={{ color: "var(--tg-hint)" }}>
                  {r.friendName ?? t.refer.unknownFriend}
                </div>
              </MCard>
            ))}
          </div>
        </MSection>
      )}

      {data.expiredCount > 0 && (
        <p
          className="mt-4 text-center text-xs"
          style={{ color: "var(--tg-hint)" }}
        >
          {t.refer.expiredFooter.replace("{n}", String(data.expiredCount))}
        </p>
      )}
    </div>
  );
}
