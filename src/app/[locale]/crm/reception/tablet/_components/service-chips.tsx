"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";

import { useDoctorServices } from "../_hooks/use-tablet-actions";
import { Caption, TOUCH } from "./tablet-ui";

/**
 * The optional «Услуга»: big chips instead of a select, «Обычный приём»
 * first and picked by default. The services are the doctor's own, priced
 * and timed as he does them.
 */
export function ServiceChips({
  doctorId,
  value,
  onChange,
}: {
  doctorId: string;
  value: string | null;
  onChange: (serviceId: string | null) => void;
}) {
  const t = useTranslations("receptionTablet.service");
  const locale = useLocale();
  const query = useDoctorServices(doctorId);
  const services = query.data ?? [];

  // A service the doctor dropped meanwhile is not offered silently.
  React.useEffect(() => {
    if (value && query.data && !query.data.some((s) => s.id === value)) onChange(null);
  }, [value, query.data, onChange]);

  if (!query.isLoading && !query.isError && services.length === 0) return null;

  const chip = (active: boolean) =>
    cn(
      TOUCH,
      "motion-press inline-flex min-h-14 items-center gap-2 rounded-2xl border px-5 py-2 text-left text-[17px] font-semibold transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border bg-card text-foreground active:bg-muted",
    );

  return (
    <section className="flex flex-col gap-3">
      <Caption>
        {t("title")} <span className="font-semibold normal-case tracking-normal">({t("optional")})</span>
      </Caption>
      {query.isLoading ? (
        <p className="text-[17px] text-muted-foreground">{t("loading")}</p>
      ) : query.isError ? (
        <p className="text-[17px] text-muted-foreground">{t("loadError")}</p>
      ) : (
        <div role="radiogroup" aria-label={t("title")} className="flex flex-wrap gap-3">
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            onClick={() => onChange(null)}
            className={chip(value === null)}
          >
            {value === null ? <CheckIcon className="size-5" aria-hidden /> : null}
            {t("none")}
          </button>
          {services.map((s) => {
            const active = s.id === value;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(s.id)}
                className={chip(active)}
              >
                {active ? <CheckIcon className="size-5 shrink-0" aria-hidden /> : null}
                <span className="flex flex-col">
                  <span>{locale === "uz" ? s.nameUz || s.nameRu : s.nameRu}</span>
                  <span className="text-[14px] font-medium text-muted-foreground">
                    {t("minutes", { min: s.durationMin })}
                    {s.price > 0 ? ` · ${formatMoney(s.price, "UZS", locale === "uz" ? "uz" : "ru")}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
