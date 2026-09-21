import { useTranslations } from "next-intl";
import { Phone, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { CONTACT, YANDEX_REVIEWS_URL } from "@/lib/constants";

// Signage-style hero: one huge flat headline, the phone number as a
// first-class CTA (for a clinic, a call IS the conversion), and a strip of
// verifiable facts. No stats, no decoration.
export function Hero() {
  const t = useTranslations("hero");
  const facts = [
    t("facts.hours"),
    t("facts.patients"),
    t("facts.diagnostics"),
  ];

  return (
    <section className="border-b border-border bg-white">
      <div className="mx-auto max-w-6xl px-4 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-24">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          {t("overline")}
        </p>

        <h1 className="mt-5 max-w-4xl text-5xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          {t("title")}
        </h1>

        <p className="mt-6 max-w-3xl text-xl leading-relaxed text-muted-foreground sm:text-2xl">
          {t("subtitle")}
        </p>

        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
          <LeadFormTrigger>
            <Button className="h-14 rounded-xl bg-primary px-9 text-lg font-semibold text-primary-foreground hover:bg-primary/90">
              {t("cta")}
            </Button>
          </LeadFormTrigger>

          <a
            href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
            className="inline-flex items-center gap-3 text-2xl font-bold tracking-tight text-foreground transition-colors hover:text-primary sm:text-3xl"
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
          className="mt-8 inline-flex items-center gap-2 text-base font-medium text-foreground transition-colors hover:text-primary"
        >
          <Star className="h-5 w-5 fill-primary text-primary" />
          <span className="font-bold">{t("trust.rating")}</span>
          <span className="text-muted-foreground">{t("trust.ratingOf")}</span>
          <span className="text-muted-foreground underline decoration-border underline-offset-4">
            {t("trust.ratingSource")}
          </span>
        </a>

        <div className="mt-14 grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-3 sm:gap-8">
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
