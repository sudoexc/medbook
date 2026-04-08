import { useTranslations, useLocale } from "next-intl";
import { Clock, MapPin, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "./lead-form";
import type { Locale } from "@/types";
import type { DoctorView } from "@/lib/doctors";

function formatPrice(price: number): string {
  return price.toLocaleString("ru-RU").replace(/,/g, " ");
}

export function Doctors({ doctors }: { doctors: DoctorView[] }) {
  const t = useTranslations("doctors");
  const locale = useLocale() as Locale;

  return (
    <section id="doctors" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-8 space-y-4">
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5 sm:flex-row sm:items-start sm:justify-between hover:border-primary/30 transition-colors"
            >
              <div className="flex gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                  {doc.name[locale].charAt(0)}
                </div>
                <div>
                  <a href={`doctors/${doc.id}`} className="text-base font-semibold text-foreground hover:text-primary transition-colors">
                    {doc.name[locale]}
                  </a>
                  <p className="text-sm text-primary">{doc.specialty[locale]}</p>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {t("cabinet")} {doc.cabinet}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {doc.schedule[locale]}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {doc.hours}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {doc.services.map((svc) => (
                      <span
                        key={svc.name[locale]}
                        className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                      >
                        {svc.name[locale]} — {formatPrice(svc.price)} {t("sum")}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="shrink-0 sm:self-center">
                <LeadFormTrigger doctorId={doc.id}>
                  <Button className="w-full sm:w-auto h-10 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/85">
                    {t("bookWith")}
                  </Button>
                </LeadFormTrigger>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
