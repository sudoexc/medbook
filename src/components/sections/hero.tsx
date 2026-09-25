import { useLocale, useTranslations } from "next-intl";
import { MapPin, Navigation, Phone, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import {
  CONTACT,
  YANDEX_MAP_WIDGET_URL,
  YANDEX_REVIEWS_URL,
  YANDEX_ROUTE_URL,
} from "@/lib/constants";
import type { Locale } from "@/types";

// Signage-style hero: one huge flat headline, the phone number as a
// first-class CTA (for a clinic, a call IS the conversion), and a strip of
// verifiable facts. No stats, no decoration.
//
// The map lives HERE, not at the bottom of the page (clinic request
// 25.09.2026): most visitors come to find the building, so the pin and a
// one-tap route have to be visible the moment the page opens.
export function Hero() {
  const t = useTranslations("hero");
  const facts = [
    t("facts.hours"),
    t("facts.patients"),
    t("facts.diagnostics"),
  ];

  return (
    <section className="border-b border-border bg-white">
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 sm:px-6 sm:pb-16 sm:pt-20">
        {/* Phone order: heading, MAP, pitch — the map must be on the first
            screen (the call/booking buttons are pinned to the bottom bar on
            phones anyway). Desktop: text left, map right, centred. */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] lg:gap-x-12">
          <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
              {t("overline")}
            </p>

            <h1 className="mt-5 text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
              {t("title")}
            </h1>
          </div>

          <div className="mt-8 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0 lg:self-center">
            <HeroMap />
          </div>

          <div className="mt-8 lg:col-start-1 lg:row-start-2 lg:mt-6 lg:self-start">
            <p className="text-xl leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>

            <div className="mt-9 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
              <LeadFormTrigger>
                <Button className="h-14 rounded-xl bg-primary px-9 text-lg font-semibold text-primary-foreground hover:bg-primary/90">
                  {t("cta")}
                </Button>
              </LeadFormTrigger>

              <a
                href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
                className="inline-flex items-center gap-3 text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary"
              >
                <Phone className="h-6 w-6 text-primary" />
                {CONTACT.phone}
              </a>
            </div>

            {/* Real, verifiable rating — checked on Yandex Maps 21.09.2026
                (4,9 / 289 оценок); the link lets anyone verify it. */}
            <a
              href={YANDEX_REVIEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-7 inline-flex items-center gap-2 text-base font-medium text-foreground transition-colors hover:text-primary"
            >
              <Star className="h-5 w-5 fill-primary text-primary" />
              <span className="font-bold">{t("trust.rating")}</span>
              <span className="text-muted-foreground">{t("trust.ratingOf")}</span>
              <span className="text-muted-foreground underline decoration-border underline-offset-4">
                {t("trust.ratingSource")}
              </span>
            </a>
          </div>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-3 sm:gap-8">
          {facts.map((fact) => (
            <p
              key={fact}
              className="flex items-center gap-3 text-base font-medium text-foreground"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {fact}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The clinic's Yandex org widget (keyless iframe, frame-src allowed in
 * next.config.ts) with the address and the route button under it. The
 * button opens Yandex Maps (the app on a phone) with the route already
 * built, so the patient only has to press «В путь».
 */
function HeroMap() {
  const t = useTranslations("directions");
  const locale = useLocale() as Locale;

  return (
    <div
      id="directions"
      className="overflow-hidden rounded-2xl border border-border bg-white"
    >
      <iframe
        src={YANDEX_MAP_WIDGET_URL}
        title={t("mapTitle")}
        className="block h-[230px] w-full border-0 sm:h-[340px] lg:h-[380px]"
      />
      <div className="flex flex-col gap-4 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-5">
        <p className="flex items-start gap-2.5 text-[15px] leading-snug text-foreground">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          {CONTACT.address[locale]}
        </p>
        <a
          href={YANDEX_ROUTE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-goal="route"
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Navigation className="h-4 w-4" />
          {t("routeCta")}
        </a>
      </div>
    </div>
  );
}
