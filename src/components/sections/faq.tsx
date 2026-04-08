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
    <section id="faq" className="py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
          {t("title")}
        </h2>

        <div className="mt-8">
          <Accordion className="space-y-2">
            {questions.map((q) => (
              <AccordionItem
                key={q}
                className="rounded-lg border border-border bg-white px-5"
              >
                <AccordionTrigger className="text-left text-sm font-medium hover:no-underline py-4">
                  {t(`${q}.question`)}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pb-4">
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
