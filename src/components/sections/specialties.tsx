"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import {
  Stethoscope,
  SmilePlus,
  Baby,
  Ear,
  Eye,
  HeartPulse,
  Brain,
  Monitor,
} from "lucide-react";
import { SPECIALTIES } from "@/lib/constants";
import type { Locale } from "@/types";

const iconMap: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  Stethoscope, SmilePlus, Baby, Ear, Eye, HeartPulse, Brain, Monitor,
};

const cardColors = [
  "group-hover:bg-blue-500",
  "group-hover:bg-emerald-500",
  "group-hover:bg-pink-500",
  "group-hover:bg-amber-500",
  "group-hover:bg-violet-500",
  "group-hover:bg-rose-500",
  "group-hover:bg-cyan-500",
  "group-hover:bg-pink-500",
  "group-hover:bg-indigo-500",
];

export function Specialties() {
  const t = useTranslations("specialties");
  const locale = useLocale() as Locale;

  return (
    <section id="specialties" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-secondary/40 to-secondary/10" />

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

        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:gap-5">
          {SPECIALTIES.map((spec, i) => {
            const Icon = iconMap[spec.icon] || Stethoscope;
            return (
              <motion.button
                key={spec.id}
                initial={{ opacity: 0, y: 15 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-20px" }}
                transition={{ duration: 0.3, delay: i * 0.04 }}
                className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border/50 bg-white p-4 text-left transition-all duration-300 hover:border-transparent hover:shadow-lg hover:shadow-black/[0.06] sm:p-5"
              >
                <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] transition-all duration-300 ${cardColors[i]} group-hover:text-white group-hover:shadow-md`}>
                  <Icon className="h-6 w-6" strokeWidth={1.5} />
                </div>
                <span className="text-[15px] font-semibold text-foreground/80 transition-colors group-hover:text-foreground">
                  {spec.name[locale]}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
