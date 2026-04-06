"use client";

import { useTranslations } from "next-intl";
import { CheckCircle, TrendingUp, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const benefits = [
  { key: "benefit1" as const },
  { key: "benefit2" as const },
  { key: "benefit3" as const },
];

export function ForDoctors() {
  const t = useTranslations("forDoctors");

  return (
    <section id="for-doctors" className="relative py-24 sm:py-32">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-secondary/40 to-secondary/10" />

      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Text */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5 }}
          >
            <span className="text-sm font-semibold uppercase tracking-widest text-primary">
              {t("subtitle")}
            </span>
            <h2 className="mt-3 text-3xl font-extrabold sm:text-[2.5rem] sm:leading-tight">
              {t("title")}
            </h2>

            <ul className="mt-8 space-y-5">
              {benefits.map((b) => (
                <li key={b.key} className="flex items-start gap-4">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent/80 shadow-sm">
                    <CheckCircle className="h-4 w-4 text-white" strokeWidth={2.5} />
                  </div>
                  <span className="text-[17px] font-medium text-foreground/80">{t(b.key)}</span>
                </li>
              ))}
            </ul>

            <Button
              size="lg"
              className="mt-10 h-12 rounded-xl bg-gradient-to-r from-primary to-primary/90 px-8 text-[15px] font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30 hover:brightness-110"
            >
              {t("cta")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </motion.div>

          {/* Dashboard mockup */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="relative"
          >
            <div className="rounded-3xl border border-border/40 bg-white p-7 shadow-2xl shadow-black/[0.06]">
              {/* Mock header */}
              <div className="flex items-center justify-between border-b border-border/40 pb-5">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10" />
                  <div>
                    <div className="h-3.5 w-32 rounded-lg bg-foreground/10" />
                    <div className="mt-2 h-2.5 w-24 rounded-lg bg-foreground/5" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5">
                  <Star className="h-3.5 w-3.5 fill-accent text-accent" />
                  <span className="text-xs font-bold text-accent">4.9</span>
                </div>
              </div>

              {/* Mock stats */}
              <div className="mt-6 grid grid-cols-3 gap-3">
                {[
                  { value: "247", color: "text-primary" },
                  { value: "4.9", color: "text-accent" },
                  { value: "128", color: "text-violet-500" },
                ].map((stat, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl bg-secondary/50 p-4 text-center"
                  >
                    <div className={`text-2xl font-extrabold ${stat.color}`}>{stat.value}</div>
                    <div className="mt-1.5 mx-auto h-2 w-14 rounded-lg bg-foreground/5" />
                  </div>
                ))}
              </div>

              {/* Chart mockup */}
              <div className="mt-5 rounded-2xl bg-secondary/30 p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="h-2.5 w-20 rounded-lg bg-foreground/10" />
                  <div className="flex items-center gap-1 text-accent">
                    <TrendingUp className="h-3.5 w-3.5" />
                    <span className="text-xs font-bold">+23%</span>
                  </div>
                </div>
                <div className="flex items-end gap-1.5 h-16">
                  {[35, 50, 40, 65, 55, 75, 60, 80, 70, 90, 85, 95].map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm bg-gradient-to-t from-primary/30 to-primary/10"
                      style={{ height: `${h}%` }}
                    />
                  ))}
                </div>
              </div>

              {/* Mock schedule */}
              <div className="mt-5 space-y-2.5">
                {[1, 2, 3].map((row) => (
                  <div
                    key={row}
                    className="flex items-center justify-between rounded-xl bg-secondary/30 px-4 py-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-primary/10" />
                      <div>
                        <div className="h-2.5 w-28 rounded-lg bg-foreground/10" />
                        <div className="mt-1.5 h-2 w-20 rounded-lg bg-foreground/5" />
                      </div>
                    </div>
                    <div className="h-7 w-16 rounded-lg bg-accent/15" />
                  </div>
                ))}
              </div>
            </div>

            {/* Decorative blurs */}
            <div className="absolute -bottom-8 -right-8 -z-10 h-56 w-56 rounded-full bg-primary/10 blur-[60px]" />
            <div className="absolute -top-8 -left-8 -z-10 h-40 w-40 rounded-full bg-accent/10 blur-[50px]" />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
