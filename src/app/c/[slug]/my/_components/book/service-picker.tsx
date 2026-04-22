"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useServices } from "../../_hooks/use-services";
import { useBookingDraft } from "../../_hooks/use-booking-draft";
import { useMiniAppAuth } from "../miniapp-auth-provider";
import { useT } from "../mini-i18n";
import {
  MCard,
  MEmpty,
  MListItem,
  MSection,
  MSpinner,
  formatSum,
} from "../mini-ui";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

export function ServicePicker() {
  const t = useT();
  const router = useRouter();
  const { clinicSlug, state } = useMiniAppAuth();
  const lang = state.status === "ready" ? state.patient.preferredLang : "RU";
  const { draft, setDraft, hydrated } = useBookingDraft(clinicSlug);
  const services = useServices();
  const tg = useTelegramWebApp();

  const categories = React.useMemo(() => {
    if (!services.data) return [];
    const groups = new Map<string, typeof services.data>();
    for (const s of services.data) {
      const key = s.category ?? "";
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [services.data]);

  const toggle = (id: string) => {
    tg.haptic.selection();
    const next = draft.serviceIds.includes(id)
      ? draft.serviceIds.filter((x) => x !== id)
      : [...draft.serviceIds, id];
    setDraft({ serviceIds: next });
  };

  const canContinue = draft.serviceIds.length > 0;

  React.useEffect(() => {
    const off = tg.setBackButton(() => {
      router.push(`/c/${clinicSlug}/my`);
    });
    return off;
  }, [tg, router, clinicSlug]);

  React.useEffect(() => {
    const off = tg.setMainButton({
      text: t.common.next,
      active: canContinue,
      visible: true,
      onClick: () => {
        if (!canContinue) return;
        router.push(`/c/${clinicSlug}/my/book/doctor`);
      },
    });
    return off;
  }, [tg, canContinue, router, clinicSlug, t.common.next]);

  if (!hydrated || services.isLoading) return <MSpinner label={t.common.loading} />;
  if (services.isError) return <MEmpty>{t.common.error}</MEmpty>;

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs uppercase tracking-wide" style={{ color: "var(--tg-hint)" }}>
          {t.book.stepService}
        </div>
        <h1 className="text-xl font-bold">{t.book.pickService}</h1>
      </div>
      {categories.length === 0 ? (
        <MEmpty>{t.book.noDoctors}</MEmpty>
      ) : (
        categories.map(([cat, items]) => (
          <MSection key={cat || "uncat"} title={cat || undefined}>
            {items.map((s) => {
              const active = draft.serviceIds.includes(s.id);
              return (
                <MListItem
                  key={s.id}
                  active={active}
                  onClick={() => toggle(s.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {lang === "UZ" ? s.nameUz : s.nameRu}
                    </div>
                    <div
                      className="mt-0.5 text-xs"
                      style={{ color: "var(--tg-hint)" }}
                    >
                      {t.book.durationLabel
                        .replace("{duration}", String(s.durationMin))
                        .replace("{unit}", t.common.min)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-sm font-semibold" style={{ color: "var(--tg-accent)" }}>
                    {formatSum(s.priceBase, t.common.currency)}
                  </div>
                </MListItem>
              );
            })}
          </MSection>
        ))
      )}
      <MCard className="sticky bottom-3 mt-4 flex items-center justify-between text-sm">
        <span style={{ color: "var(--tg-hint)" }}>
          {draft.serviceIds.length} ·{" "}
          {formatSum(
            services.data
              ?.filter((s) => draft.serviceIds.includes(s.id))
              .reduce((a, s) => a + s.priceBase, 0) ?? 0,
            t.common.currency,
          )}
        </span>
      </MCard>
    </div>
  );
}
