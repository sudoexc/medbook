"use client";

import { useTranslations } from "next-intl";
import { Search, CalendarCheck, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";

const steps = [
  { icon: Search, key: "step1" as const, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
  { icon: CalendarCheck, key: "step2" as const, gradient: "from-accent/10 to-accent/5", iconColor: "text-accent" },
  { icon: CheckCircle, key: "step3" as const, gradient: "from-primary/10 to-primary/5", iconColor: "text-primary" },
];

export function HowItWorks() {
  const t = useTranslations("howItWorks");

  return (
    <section id="how-it-works" className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-center"
        >
          <span className="text-sm font-semibold uppercase tracking-widest text-primary">
            {t("subtitle")}
          </span>
          <h2 className="mt-3 text-3xl font-extrabold sm:text-[2.5rem] sm:leading-tight">
            {t("title")}
          </h2>
        </motion.div>

        <div className="relative mt-20 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6 lg:gap-12">
          {/* Connector line desktop */}
          <div className="absolute top-[52px] left-[calc(16.67%+40px)] right-[calc(16.67%+40px)] hidden h-[2px] bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 sm:block" />

          {steps.map((step, i) => (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.45, delay: i * 0.15 }}
              className="relative flex flex-col items-center text-center"
            >
              {/* Icon container */}
              <div className="relative">
                <div className={`flex h-[104px] w-[104px] items-center justify-center rounded-3xl bg-gradient-to-br ${step.gradient} ring-1 ring-border/40`}>
                  <step.icon className={`h-10 w-10 ${step.iconColor}`} strokeWidth={1.5} />
                </div>
                <span className="absolute -top-3 -right-3 flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 text-sm font-bold text-white shadow-lg shadow-primary/25">
                  {i + 1}
                </span>
              </div>

              <h3 className="mt-7 text-xl font-bold">{t(`${step.key}.title`)}</h3>
              <p className="mt-2.5 max-w-[280px] text-[15px] leading-relaxed text-muted-foreground">
                {t(`${step.key}.description`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
