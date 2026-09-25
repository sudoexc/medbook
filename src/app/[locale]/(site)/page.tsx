import { Hero } from "@/components/sections/hero";
import { Visit } from "@/components/sections/visit";
import { TelegramShowcase } from "@/components/sections/telegram-showcase";
import { Doctors } from "@/components/sections/doctors";
import { Services } from "@/components/sections/services";
import { Reviews } from "@/components/sections/reviews";
import { Cta } from "@/components/sections/cta";
import { Faq } from "@/components/sections/faq";
import { getDoctors } from "@/lib/doctors";
import { serializeJsonLd } from "@/lib/json-ld";
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
  const doctors = await getDoctors();

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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }}
      />
      <Hero />
      <Visit />
      <TelegramShowcase />
      <Doctors doctors={doctors} />
      <Services />
      <Reviews />
      <Faq />
      <Cta />
    </main>
  );
}
