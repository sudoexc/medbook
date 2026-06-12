"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  MButton,
  MCard,
  MHint,
  MSection,
  MSpinner,
} from "./mini-ui";
import { useT } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useProfile, useUpdateProfile } from "../_hooks/use-profile";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function ProfileScreen() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const profile = useProfile();
  const update = useUpdateProfile();

  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [lang, setLang] = React.useState<"RU" | "UZ">("RU");
  const [consent, setConsent] = React.useState(false);
  // Phase 17 Wave 1 — marketing opt-OUT pathway. UI surfaces the inverse
  // ("receive marketing notifications") so default-ON reads naturally; we
  // translate back to the API's opt-out flag when saving.
  const [marketingAllowed, setMarketingAllowed] = React.useState(true);

  React.useEffect(() => {
    if (profile.data) {
      setName(profile.data.fullName);
      setPhone(profile.data.phone);
      setLang(profile.data.preferredLang);
      setConsent(profile.data.consentMarketing);
      setMarketingAllowed(!profile.data.marketingOptOut);
    }
  }, [profile.data]);

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  const onSave = async () => {
    try {
      await update.mutateAsync({
        fullName: name,
        phone: phone || undefined,
        lang,
        consentMarketing: consent,
        marketingOptOut: !marketingAllowed,
      });
      tg.haptic.notification("success");
      tg.showAlert(t.profile.saved);
    } catch (e) {
      tg.haptic.notification("error");
      const err = e as Error & { status?: number; data?: { reason?: string } };
      if (err.data?.reason === "phone_taken") tg.showAlert(t.profile.errorPhoneTaken);
      else if (err.data?.reason === "bad_phone") tg.showAlert(t.profile.errorPhone);
      else tg.showAlert(err.message);
    }
  };

  // Profile is a tab-bar screen — the native MainButton would stack a second
  // bottom bar under the tabs, so the save CTA lives inline in the form.
  React.useEffect(() => {
    const off = tg.setMainButton({ visible: false });
    return off;
  }, [tg]);

  if (profile.isLoading) return <MSpinner label={t.common.loading} />;

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">{t.profile.title}</h1>
      <MSection>
        <MCard className="space-y-4">
          <label className="block">
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
              {t.profile.nameLabel}
            </div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border px-3 py-3 text-sm outline-none transition focus:border-[var(--tg-accent)] focus:ring-2 focus:ring-[var(--tg-accent)] focus:ring-offset-0"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
          <label className="block">
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
              {t.profile.phoneLabel}
            </div>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 000 00 00"
              className="w-full rounded-xl border px-3 py-3 text-sm outline-none transition focus:border-[var(--tg-accent)] focus:ring-2 focus:ring-[var(--tg-accent)] focus:ring-offset-0"
              style={{
                backgroundColor: "var(--tg-bg)",
                borderColor: "color-mix(in oklch, var(--tg-hint) 30%, transparent)",
                color: "var(--tg-text)",
              }}
            />
          </label>
          <div>
            <div className="mb-1 text-xs font-medium" style={{ color: "var(--tg-hint)" }}>
              {t.profile.langLabel}
            </div>
            <div className="flex gap-2">
              {(["RU", "UZ"] as const).map((l) => (
                <MButton
                  key={l}
                  variant={lang === l ? "primary" : "secondary"}
                  block
                  onClick={() => setLang(l)}
                  type="button"
                >
                  {l === "RU" ? t.lang.ru : t.lang.uz}
                </MButton>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="h-5 w-5 rounded"
            />
            <span>{t.profile.consentLabel}</span>
          </label>
        </MCard>
      </MSection>
      {/* Phase 17 Wave 1 — Communication preferences (marketing opt-out). */}
      <MSection title={t.profile.preferencesTitle}>
        <MCard className="space-y-3">
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={marketingAllowed}
              onChange={(e) => setMarketingAllowed(e.target.checked)}
              className="h-5 w-5 rounded"
            />
            <span>{t.profile.marketingToggle}</span>
          </label>
          <MHint>{t.profile.marketingHint}</MHint>
        </MCard>
      </MSection>
      <MButton
        block
        variant="primary"
        type="button"
        onClick={onSave}
        disabled={update.isPending}
        className="mb-2"
      >
        {update.isPending ? (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
        ) : null}
        {t.profile.saveBtn}
      </MButton>
      {/* Phase 17 Wave 3 — DSAR controls. */}
      <AccountDsarSection clinicSlug={clinicSlug} />
      <MHint>
        {t.book.phoneHint}
      </MHint>
    </div>
  );
}

// ─── Phase 17 Wave 3 — DSAR section ──────────────────────────────────────
//
// Lives inside the profile screen (the natural "settings" surface in the
// Mini App). One button to enqueue an export, one link to the dedicated
// /account/delete page.
function AccountDsarSection({ clinicSlug }: { clinicSlug: string }) {
  const t = useT();
  const router = useRouter();
  const tg = useTelegramWebApp();
  const [busy, setBusy] = React.useState(false);

  const onExport = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/miniapp/account/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": tg.initData ?? "",
        },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { reused?: boolean; error?: string };
      if (!res.ok) {
        if (data.error === "no_telegram_chat") {
          tg.showAlert(t.account.exportNoTelegram);
        } else {
          tg.showAlert(t.account.exportError);
        }
        return;
      }
      tg.haptic.notification("success");
      tg.showAlert(
        data.reused ? t.account.exportAlreadyRequested : t.account.exportSuccess,
      );
    } catch {
      tg.showAlert(t.account.exportError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MSection title={t.account.sectionTitle}>
      <MCard className="space-y-3">
        <div className="text-sm font-medium">{t.account.exportCta}</div>
        <MHint>{t.account.exportSubtitle}</MHint>
        <MButton
          variant="secondary"
          block
          disabled={busy}
          onClick={onExport}
          type="button"
        >
          {busy ? t.account.exportRequesting : t.account.exportCta}
        </MButton>
      </MCard>
      <MCard className="space-y-3" style={{ marginTop: 12 }}>
        <div className="text-sm font-medium">{t.account.deleteCta}</div>
        <MHint>{t.account.deleteSubtitle}</MHint>
        <MButton
          variant="secondary"
          block
          onClick={() => router.push(`/c/${clinicSlug}/my/account/delete`)}
          type="button"
        >
          {t.account.deleteCta}
        </MButton>
      </MCard>
    </MSection>
  );
}
