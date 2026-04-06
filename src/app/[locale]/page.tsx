import { Hero } from "@/components/sections/hero";
import { HowItWorks } from "@/components/sections/how-it-works";
import { Specialties } from "@/components/sections/specialties";
import { Advantages } from "@/components/sections/advantages";
import { ForDoctors } from "@/components/sections/for-doctors";
import { AppTeaser } from "@/components/sections/app-teaser";
import { Faq } from "@/components/sections/faq";
import { SITE_DOMAIN } from "@/lib/constants";
import ruMessages from "@/messages/ru.json";
import uzMessages from "@/messages/uz.json";

const msgs: Record<string, typeof ruMessages> = { ru: ruMessages, uz: uzMessages };

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const faq = msgs[locale]?.faq || msgs.ru.faq;

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: Object.entries(faq)
      .filter(([key]) => key.startsWith("q"))
      .map(([, val]) => ({
        "@type": "Question",
        name: (val as { question: string }).question,
        acceptedAnswer: {
          "@type": "Answer",
          text: (val as { answer: string }).answer,
        },
      })),
  };

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <Hero />
      <HowItWorks />
      <Specialties />
      <Advantages />
      <ForDoctors />
      <AppTeaser />
      <Faq />
    </main>
  );
}
