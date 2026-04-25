"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bone,
  Brain,
  Dumbbell,
  HandHelping,
  HeartPulse,
  MoreHorizontal,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { useDoctors } from "../../_hooks/use-doctors";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import { MEmpty, MSpinner } from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";
import { WizardHeader } from "./wizard-header";
import { WizardFooter } from "./wizard-footer";

const INITIAL_VISIBLE = 5;

/**
 * Pick an icon for a given specialization label. Matching is fuzzy on the
 * Russian or Uzbek root so localized variants still get the right glyph;
 * falls back to a generic stethoscope when nothing matches.
 */
function iconForSpec(name: string): React.ComponentType<{ className?: string }> {
  const n = name.toLowerCase();
  if (n.includes("невро") || n.includes("nevro")) return Brain;
  if (n.includes("ортопед") || n.includes("ortoped")) return Bone;
  if (n.includes("терапев") || n.includes("terapev")) return Stethoscope;
  if (n.includes("лфк") || n.includes("lfk") || n.includes("гимнаст")) return Dumbbell;
  if (n.includes("масса") || n.includes("massa")) return HandHelping;
  if (n.includes("карди") || n.includes("kardi")) return HeartPulse;
  return UserRound;
}

type Spec = {
  key: string;
  labelRu: string;
  labelUz: string;
  count: number;
};

export function ServicePicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const doctors = useDoctors(null);
  const tg = useTelegramWebApp();
  const [expanded, setExpanded] = React.useState(false);

  const specs: Spec[] = React.useMemo(() => {
    if (!doctors.data) return [];
    const bucket = new Map<string, Spec>();
    for (const d of doctors.data) {
      const key = d.specializationRu.trim();
      if (!key) continue;
      const existing = bucket.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        bucket.set(key, {
          key,
          labelRu: d.specializationRu,
          labelUz: d.specializationUz || d.specializationRu,
          count: 1,
        });
      }
    }
    return Array.from(bucket.values()).sort((a, b) => b.count - a.count);
  }, [doctors.data]);

  const visibleSpecs = expanded ? specs : specs.slice(0, INITIAL_VISIBLE);
  const canContinue = !!draft.specialization;

  const goNext = React.useCallback(() => {
    if (!canContinue) return;
    router.push(`/c/${clinicSlug}/my/book/doctor`);
  }, [canContinue, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.book.continue,
      active: canContinue,
      visible: true,
      onClick: goNext,
    });
    return off;
  }, [tg, canContinue, goNext, t.book.continue]);

  if (!hydrated || doctors.isLoading) return <MSpinner label={t.common.loading} />;
  if (doctors.isError) return <MEmpty>{t.common.error}</MEmpty>;

  return (
    <div className="ma-step-enter">
      <WizardHeader
        step={1}
        label={t.book.stepLabel.replace("{step}", "1").replace("{total}", "4")}
        title={t.book.stepService}
      />
      {specs.length === 0 ? (
        <MEmpty>{t.book.noSpecializations}</MEmpty>
      ) : (
        <div className="space-y-2">
          {visibleSpecs.map((s) => {
            const Icon = iconForSpec(s.key);
            const active = draft.specialization === s.key;
            const label = lang === "UZ" ? s.labelUz : s.labelRu;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => {
                  tg.haptic.selection();
                  setDraft({
                    specialization: s.key,
                    doctorId: null,
                    serviceIds: [],
                    date: null,
                    time: null,
                  });
                }}
                className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition active:scale-[0.99]"
                style={{
                  backgroundColor: active
                    ? "color-mix(in oklch, var(--tg-accent) 8%, var(--tg-section-bg))"
                    : "var(--tg-section-bg)",
                  color: active ? "var(--tg-accent)" : "var(--tg-text)",
                  boxShadow: active
                    ? `0 0 0 2px var(--tg-accent)`
                    : "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                  style={{
                    backgroundColor: active
                      ? "var(--tg-accent)"
                      : "color-mix(in oklch, var(--tg-accent) 12%, transparent)",
                    color: active ? "#fff" : "var(--tg-accent)",
                  }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{label}</div>
                </div>
                {active ? <CheckCircle /> : null}
              </button>
            );
          })}
          {specs.length > INITIAL_VISIBLE ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition active:scale-[0.99]"
              style={{
                backgroundColor: "var(--tg-section-bg)",
                color: "var(--tg-hint)",
              }}
            >
              <div
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                style={{
                  backgroundColor: "color-mix(in oklch, var(--tg-hint) 15%, transparent)",
                  color: "var(--tg-hint)",
                }}
              >
                <MoreHorizontal className="h-5 w-5" />
              </div>
              <span className="text-sm font-semibold">
                {expanded ? t.book.showLess : t.book.showMore}
              </span>
            </button>
          ) : null}
        </div>
      )}
      <WizardFooter
        primaryLabel={t.book.continue}
        onPrimary={goNext}
        disabled={!canContinue}
        tagline={t.book.clinicTagline}
      />
    </div>
  );
}

function CheckCircle() {
  return (
    <div
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
      style={{ backgroundColor: "var(--tg-accent)", color: "#fff" }}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}>
        <path d="M5 12l4 4L19 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
