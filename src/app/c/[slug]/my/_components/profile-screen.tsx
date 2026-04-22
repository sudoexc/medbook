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

  React.useEffect(() => {
    if (profile.data) {
      setName(profile.data.fullName);
      setPhone(profile.data.phone);
      setLang(profile.data.preferredLang);
      setConsent(profile.data.consentMarketing);
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

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.profile.saveBtn,
      active: !update.isPending,
      progress: update.isPending,
      visible: true,
      onClick: onSave,
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tg, update.isPending, name, phone, lang, consent]);

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
              className="w-full rounded-xl border px-3 py-3 text-sm"
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
              className="w-full rounded-xl border px-3 py-3 text-sm"
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
      <MHint>
        {t.book.phoneHint}
      </MHint>
    </div>
  );
}
