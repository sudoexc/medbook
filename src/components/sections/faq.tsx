"use client";

import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { motion } from "framer-motion";

const questions = ["q1", "q2", "q3", "q4", "q5"] as const;

export function Faq() {
  const t = useTranslations("faq");

  return (
    <section id="faq" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-secondary/40 to-transparent" />

      <div className="mx-auto max-w-3xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <h2 className="text-3xl font-extrabold sm:text-[2.5rem] sm:leading-tight">
            {t("title")}
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mt-14"
        >
          <Accordion className="space-y-3">
            {questions.map((q) => (
              <AccordionItem
                key={q}
                className="rounded-2xl border border-border/40 bg-white px-7 shadow-sm transition-shadow hover:shadow-md"
              >
                <AccordionTrigger className="text-left text-[16px] font-semibold hover:no-underline py-6">
                  {t(`${q}.question`)}
                </AccordionTrigger>
                <AccordionContent className="text-[15px] leading-relaxed text-muted-foreground pb-6">
                  {t(`${q}.answer`)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
