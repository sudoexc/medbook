import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const questions = ["q1", "q2", "q3", "q4", "q5"] as const;

export function Faq() {
  const t = useTranslations("faq");

  return (
    <section id="faq" className="border-t border-border bg-white py-16 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t("title")}
        </h2>

        <div className="mt-8">
          <Accordion className="space-y-2">
            {questions.map((q) => (
              <AccordionItem
                key={q}
                className="rounded-lg border border-border bg-white px-5"
              >
                <AccordionTrigger className="text-left text-base font-medium hover:no-underline py-5">
                  {t(`${q}.question`)}
                </AccordionTrigger>
                <AccordionContent className="text-base leading-relaxed text-muted-foreground pb-5">
                  {t(`${q}.answer`)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
