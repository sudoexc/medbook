"use client";

import { useTranslations } from "next-intl";
import { Search, MapPin, ShieldCheck, UserCheck, Clock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { motion } from "framer-motion";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/[0.04] via-primary/[0.02] to-transparent" />
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-0 right-0 h-[600px] w-[600px] rounded-full bg-primary/[0.03] blur-[100px]" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-accent/[0.04] blur-[80px]" />
      </div>
      {/* Subtle grid pattern */}
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#8881_1px,transparent_1px),linear-gradient(to_bottom,#8881_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)]" />

      <div className="mx-auto max-w-7xl px-5 sm:px-8 pt-16 pb-24 sm:pt-28 sm:pb-36">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-4 py-1.5 text-sm font-medium text-primary"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            {t("stats.doctors")}
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 }}
            className="max-w-4xl text-[2.5rem] leading-[1.1] font-extrabold tracking-tight text-foreground sm:text-6xl lg:text-[4.25rem]"
          >
            {t("title")}
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl"
          >
            {t("subtitle")}
          </motion.p>

          {/* Search Form */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-10 w-full max-w-2xl"
          >
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border/60 bg-white p-2.5 shadow-xl shadow-black/[0.04] sm:flex-row sm:items-center sm:gap-0 sm:rounded-full sm:p-1.5">
              <div className="flex flex-1 items-center gap-2.5 px-5 py-3 sm:py-0">
                <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder={t("searchPlaceholder")}
                  className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
                  readOnly
                />
              </div>
              <div className="hidden sm:block h-7 w-px bg-border/60" />
              <div className="flex flex-1 items-center gap-2.5 px-5 py-3 sm:py-0">
                <MapPin className="h-[18px] w-[18px] shrink-0 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder={t("locationPlaceholder")}
                  className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/50"
                  readOnly
                />
              </div>
              <LeadFormTrigger>
                <Button className="h-11 rounded-xl bg-gradient-to-r from-primary to-primary/90 px-7 text-[15px] font-semibold text-white shadow-md shadow-primary/25 transition-all hover:shadow-lg hover:shadow-primary/30 hover:brightness-110 sm:rounded-full">
                  {t("searchButton")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </LeadFormTrigger>
            </div>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-4"
          >
            {[
              { icon: UserCheck, text: t("stats.doctors"), color: "text-primary" },
              { icon: Clock, text: t("stats.appointments"), color: "text-primary" },
              { icon: ShieldCheck, text: t("stats.free"), color: "text-accent" },
            ].map(({ icon: Icon, text, color }) => (
              <div key={text} className="flex items-center gap-2.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-current/[0.08] ${color}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium text-muted-foreground">{text}</span>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
