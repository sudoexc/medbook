import { useTranslations } from "next-intl";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { CONTACT } from "@/lib/constants";

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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {t("overline")}
        </p>

        <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl lg:text-7xl">
          {t("title")}
        </h1>

        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          {t("subtitle")}
        </p>

        <div className="mt-10 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-8">
          <LeadFormTrigger>
            <Button className="h-12 rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground hover:bg-primary/90">
              {t("cta")}
            </Button>
          </LeadFormTrigger>

          <a
            href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
            className="inline-flex items-center gap-2.5 text-xl font-bold tracking-tight text-foreground transition-colors hover:text-primary sm:text-2xl"
          >
            <Phone className="h-5 w-5 text-primary" />
            {CONTACT.phone}
          </a>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-3 sm:gap-8">
          {facts.map((fact) => (
            <p
              key={fact}
              className="flex items-center gap-3 text-sm font-medium text-foreground"
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
