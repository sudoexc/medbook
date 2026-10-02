import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { getDoctorById } from "@/lib/doctors";
import { serializeJsonLd } from "@/lib/json-ld";
import { CONTACT } from "@/lib/constants";
import { siteSectionHref } from "@/lib/site-nav";
import { siteAlternates, siteUrl } from "@/lib/site-urls";
import { SITE_OG_IMAGES } from "@/lib/site-meta";
import type { Locale } from "@/types";
import ruMessages from "@/messages/ru.json";
import uzMessages from "@/messages/uz.json";

const msgs: Record<string, typeof ruMessages> = { ru: ruMessages, uz: uzMessages };

// Compact 1-letter monogram for the photo-less avatar plaque.
function monogram(name: string): string {
  return name.trim().charAt(0).toUpperCase();
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
    // Absolute: the message already ends in «| NeuroFax», and the layout's
    // «%s | NeuroFax» template doubled the brand (audit LD-12).
    title: { absolute: title },
    description,
    // The address the router serves, "/doctors/<id>" for ru (audit LD-03):
    // "/ru/doctors/<id>" answered with a redirect.
    alternates: siteAlternates(locale, `/doctors/${id}`),
    openGraph: {
      title,
      description,
      type: "profile",
      url: siteUrl(locale, `/doctors/${id}`),
      // A page's openGraph replaces the layout's whole block, image included.
      images: SITE_OG_IMAGES,
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
      {/* name/specialty are written by the doctor from their profile, so
          the block must go through the escaping serialiser (audit LD-02). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <a
          href={siteSectionHref("doctors", locale, false)}
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

        {/* CTA — only when the CRM can actually serve a new request for
            this doctor; otherwise the phone is the honest path. */}
        <div className="mt-10">
          {doctor.bookable ? (
            <LeadFormTrigger doctorId={doctor.id}>
              <Button className="h-12 w-full rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground hover:bg-primary/85 sm:w-auto">
                {t.bookAppointment}
              </Button>
            </LeadFormTrigger>
          ) : (
            <a href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}>
              <Button className="h-12 w-full rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground hover:bg-primary/85 sm:w-auto">
                {CONTACT.phone}
              </Button>
            </a>
          )}
        </div>
      </div>
    </main>
  );
}
