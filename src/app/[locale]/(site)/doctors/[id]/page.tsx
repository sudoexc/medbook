import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { getDoctorById, getDoctors } from "@/lib/doctors";
import { SITE_DOMAIN, CONTACT } from "@/lib/constants";
import type { Locale } from "@/types";
import ruMessages from "@/messages/ru.json";
import uzMessages from "@/messages/uz.json";

const msgs: Record<string, typeof ruMessages> = { ru: ruMessages, uz: uzMessages };

// Compact 1-letter monogram for the photo-less avatar plaque.
function monogram(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}

export async function generateStaticParams() {
  const doctors = await getDoctors();
  const locales: Locale[] = ["ru", "uz"];
  return locales.flatMap((locale) =>
    doctors.map((doc) => ({ locale, id: doc.id }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const doctor = await getDoctorById(id);
  if (!doctor) return {};

  const loc = (locale === "uz" ? "uz" : "ru") as Locale;
  const t = msgs[loc].doctorPage;

  const title = t.metaTitle
    .replace("{name}", doctor.name[loc])
    .replace("{specialty}", doctor.specialty[loc]);
  const description = t.metaDescription
    .replace("{name}", doctor.name[loc])
    .replace("{specialty}", doctor.specialty[loc]);

  return {
    title,
    description,
    alternates: {
      canonical: `https://${SITE_DOMAIN}/${locale}/doctors/${id}`,
      languages: { ru: `/ru/doctors/${id}`, uz: `/uz/doctors/${id}` },
    },
    openGraph: {
      title,
      description,
      type: "profile",
      url: `https://${SITE_DOMAIN}/${locale}/doctors/${id}`,
    },
  };
}

export default async function DoctorPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const doctor = await getDoctorById(id);
  if (!doctor) notFound();

  const loc = (locale === "uz" ? "uz" : "ru") as Locale;
  const t = msgs[loc].doctorPage;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Physician",
    name: doctor.name[loc],
    medicalSpecialty: doctor.specialty[loc],
    worksFor: {
      "@type": "MedicalClinic",
      name: "NeuroFax",
      telephone: CONTACT.phone,
      address: {
        "@type": "PostalAddress",
        streetAddress: CONTACT.address[loc],
        addressLocality: loc === "ru" ? "Ташкент" : "Toshkent",
        addressCountry: "UZ",
      },
    },
  };

  return (
    <main className="flex-1 py-10 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <a
          href={`/${locale}#doctors`}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t.backToAll}
        </a>

        {/* Doctor header */}
        <div className="flex items-start gap-5">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {monogram(doctor.name[loc])}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{doctor.name[loc]}</h1>
            <p className="mt-1 font-medium text-primary">{doctor.specialty[loc]}</p>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-10">
          <LeadFormTrigger doctorId={doctor.id}>
            <Button className="h-12 w-full rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground hover:bg-primary/85 sm:w-auto">
              {t.bookAppointment}
            </Button>
          </LeadFormTrigger>
        </div>
      </div>
    </main>
  );
}
