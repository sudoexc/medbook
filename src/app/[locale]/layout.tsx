import { NextIntlClientProvider, hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { SITE_NAME, SITE_DOMAIN, CONTACT } from "@/lib/constants";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin", "cyrillic"],
});

const meta: Record<string, { title: string; description: string }> = {
  ru: {
    title: `${SITE_NAME} — Медицинский центр неврологии и кардиологии в Ташкенте`,
    description:
      "Медицинский центр NeuroFax — неврология, кардиология, УЗИ-диагностика в Ташкенте. Опытные специалисты, современное оборудование.",
  },
  uz: {
    title: `${SITE_NAME} — Toshkentda nevrologiya va kardiologiya tibbiyot markazi`,
    description:
      "NeuroFax tibbiyot markazi — nevrologiya, kardiologiya, UZI diagnostikasi Toshkentda. Tajribali mutaxassislar, zamonaviy uskunalar.",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const m = meta[locale] || meta.ru;
  const url = `https://${SITE_DOMAIN}/${locale}`;

  return {
    title: { default: m.title, template: `%s | ${SITE_NAME}` },
    description: m.description,
    metadataBase: new URL(`https://${SITE_DOMAIN}`),
    alternates: {
      canonical: url,
      languages: { ru: `/ru`, uz: `/uz` },
    },
    openGraph: {
      title: m.title,
      description: m.description,
      url,
      siteName: SITE_NAME,
      locale: locale === "uz" ? "uz_UZ" : "ru_RU",
      type: "website",
    },
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
    url: `https://${SITE_DOMAIN}/${locale}`,
    description: meta[locale]?.description || meta.ru.description,
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
    <html lang={locale} className={`${inter.variable} h-full antialiased scroll-smooth`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
