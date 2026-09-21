import { useTranslations, useLocale } from "next-intl";
import { ArrowRight } from "lucide-react";
import { LeadFormTrigger } from "./lead-form";
import type { Locale } from "@/types";
import type { DoctorView } from "@/lib/doctors";

// Doctors render as an initial-monogram plaque, not a photo. Remote photos
// live on the private MinIO host, which is not in the site CSP `img-src`
// (see next.config.ts) nor in `images.remotePatterns`, so a <img>/<Image>
// would be blocked/throw. A clean monogram is the reliable, on-brand
// fallback the owner asked for. If photos are ever needed, add the MinIO
// host to both configs first.
function monogram(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export function Doctors({ doctors }: { doctors: DoctorView[] }) {
  const t = useTranslations("doctors");
  const locale = useLocale() as Locale;

  if (doctors.length === 0) return null;

  return (
    <section id="doctors" className="border-t border-border bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>
        <p className="mt-2 text-lg text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col justify-between rounded-2xl border border-border bg-white p-7 transition-colors hover:border-primary/40"
            >
              <div>
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-primary/10 text-2xl font-bold text-primary">
                  {monogram(doc.name[locale])}
                </div>
                {/* Full name, wrapped — never truncated. */}
                <a
                  href={`doctors/${doc.id}`}
                  className="mt-5 block text-xl font-semibold leading-snug text-foreground transition-colors hover:text-primary"
                >
                  {doc.name[locale]}
                </a>
                <p className="mt-1.5 text-base text-muted-foreground">
                  {doc.specialty[locale]}
                </p>
              </div>

              {/* New requests only for doctors the CRM serves; the rest are
                  presented as staff, booked by phone via reception. */}
              {doc.bookable && (
                <div className="mt-5">
                  <LeadFormTrigger doctorId={doc.id}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-base font-semibold text-primary transition-opacity hover:opacity-75"
                    >
                      {t("bookWith")}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </LeadFormTrigger>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
