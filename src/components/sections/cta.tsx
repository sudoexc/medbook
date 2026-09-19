import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "./lead-form";
import { CONTACT } from "@/lib/constants";
import type { Locale } from "@/types";

// The page's closing statement: a flat panel in the clinic blue with the
// phone number as the biggest thing on it. For a clinic the call is the
// conversion — the form is the secondary path.
export function Cta() {
  const t = useTranslations("contact");
  const tf = useTranslations("footer");
  const locale = useLocale() as Locale;

  return (
    <section id="contacts" className="bg-primary py-16 text-primary-foreground sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {t("title")}
            </h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-white/75">
              {t("note")}
            </p>
            <LeadFormTrigger>
              <Button className="mt-8 h-12 rounded-xl bg-white px-8 text-base font-semibold text-primary hover:bg-white/90">
                {t("formCta")}
              </Button>
            </LeadFormTrigger>
          </div>

          <div>
            <a
              href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
              className="block text-4xl font-bold tracking-tight transition-opacity hover:opacity-85 sm:text-5xl"
            >
              {CONTACT.phone}
            </a>
            <div className="mt-8 grid grid-cols-1 gap-6 text-sm sm:grid-cols-2">
              <div>
                <p className="text-white/60">{t("addressLabel")}</p>
                <p className="mt-1 font-medium leading-relaxed">
                  {CONTACT.address[locale]}
                </p>
              </div>
              <div>
                <p className="text-white/60">{t("hoursLabel")}</p>
                <p className="mt-1 font-medium leading-relaxed">
                  {tf("workingHoursValue")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
