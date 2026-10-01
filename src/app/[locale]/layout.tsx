import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import type { Metadata } from "next";
import { SITE_NAME, SITE_DOMAIN, CONTACT } from "@/lib/constants";
import { LocaleHtmlLang } from "@/components/locale-html-lang";
import { serializeJsonLd } from "@/lib/json-ld";
import { siteMeta, siteOpenGraph } from "@/lib/site-meta";
import { siteUrl } from "@/lib/site-urls";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const m = siteMeta(locale);

  // No canonical / hreflang / og:url here (audit LD-03): every page under
  // this layout inherited the landing's, so /privacy, /terms and the CRM
  // pages declared https://neurofax.uz/ru (a 307 to "/") their canonical.
  // Each public page sets its own through siteAlternates / siteOpenGraph.
  return {
    title: { default: m.title, template: `%s | ${SITE_NAME}` },
    description: m.description,
    metadataBase: new URL(`https://${SITE_DOMAIN}`),
    openGraph: siteOpenGraph(locale),
    twitter: {
      card: "summary_large_image",
      title: m.title,
      description: m.description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "MedicalBusiness",
    name: SITE_NAME,
    url: siteUrl(locale, "/"),
    description: siteMeta(locale).description,
    telephone: CONTACT.phone,
    medicalSpecialty: ["Neurology", "Cardiology", "Diagnostic Imaging", "Pediatric Neurology"],
    areaServed: {
      "@type": "City",
      name: "Tashkent",
    },
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      opens: "08:00",
      closes: "17:00",
    },
    availableLanguage: [
      { "@type": "Language", name: "Russian" },
      { "@type": "Language", name: "Uzbek" },
    ],
  };

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <LocaleHtmlLang locale={locale} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      {children}
    </NextIntlClientProvider>
  );
}
