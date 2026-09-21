import { useTranslations, useLocale } from "next-intl";
import { MapPinIcon, ClockIcon, PhoneIcon, ExternalLinkIcon } from "lucide-react";

import {
  CONTACT,
  YANDEX_MAP_WIDGET_URL,
  YANDEX_REVIEWS_URL,
} from "@/lib/constants";
import type { Locale } from "@/types";

/**
 * A local clinic lives or dies by its neighbourhood — the address deserves a
 * section, not a footer line. The map is the Yandex org widget (keyless,
 * frame-src allowed in next.config.ts); the route button opens the same org
 * card so the numbers on the map and in our reviews always match.
 */
export function Directions() {
  const t = useTranslations("directions");
  const tf = useTranslations("footer");
  const locale = useLocale() as Locale;

  return (
    <section id="directions" className="border-t border-border bg-[#f4f8fc] py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="overflow-hidden rounded-2xl border border-border bg-white">
            <iframe
              src={YANDEX_MAP_WIDGET_URL}
              title={t("mapTitle")}
              loading="lazy"
              className="h-[320px] w-full border-0 sm:h-[400px]"
            />
          </div>

          <div className="flex flex-col justify-center gap-6">
            <div className="flex items-start gap-3">
              <MapPinIcon className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">{t("addressLabel")}</p>
                <p className="mt-1 text-lg font-semibold leading-snug text-foreground">
                  {CONTACT.address[locale]}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <ClockIcon className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">{t("hoursLabel")}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {tf("workingHoursValue")}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <PhoneIcon className="mt-1 h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">{t("phoneLabel")}</p>
                <a
                  href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
                  className="mt-1 block text-lg font-semibold tabular-nums text-foreground transition-colors hover:text-primary"
                >
                  {CONTACT.phone}
                </a>
              </div>
            </div>

            <a
              href={YANDEX_REVIEWS_URL.replace(/reviews\/$/, "")}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {t("yandexRoute")}
              <ExternalLinkIcon className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
