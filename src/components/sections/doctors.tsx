import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
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
    <section id="doctors" className="border-t border-border py-16 sm:py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t("title")}
        </h2>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col rounded-xl border border-border bg-white p-5 transition-colors hover:border-primary/40"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                  {monogram(doc.name[locale])}
                </div>
                <div className="min-w-0">
                  <a
                    href={`doctors/${doc.id}`}
                    className="block truncate text-base font-semibold text-foreground transition-colors hover:text-primary"
                  >
                    {doc.name[locale]}
                  </a>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {doc.specialty[locale]}
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <LeadFormTrigger doctorId={doc.id}>
                  <Button className="h-10 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/85">
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
