"use client";

import { useTranslations } from "next-intl";
import { Smartphone, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

export function AppTeaser() {
  const t = useTranslations("appTeaser");

  return (
    <section className="py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-5 sm:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-50px" }}
          transition={{ duration: 0.5 }}
          className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary via-primary/95 to-blue-700 px-6 py-16 sm:px-16 sm:py-24"
        >
          {/* Decorations */}
          <div className="absolute -top-20 -right-20 h-80 w-80 rounded-full bg-white/[0.07] blur-[2px]" />
          <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-white/[0.04]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-white/[0.03] blur-[80px]" />
          {/* Dots pattern */}
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[size:24px_24px]" />

          <div className="relative flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white/[0.12] ring-1 ring-white/20 backdrop-blur-sm">
              <Smartphone className="h-10 w-10 text-white" strokeWidth={1.5} />
            </div>

            <h2 className="mt-8 text-3xl font-extrabold text-white sm:text-[2.5rem] sm:leading-tight">
              {t("title")}
            </h2>
            <p className="mt-4 max-w-lg text-lg text-white/70">
              {t("subtitle")}
            </p>

            <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row">
              <input
                type="text"
                placeholder={t("placeholder")}
                className="flex-1 rounded-2xl bg-white/[0.12] px-6 py-4 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-2 focus:ring-white/30 backdrop-blur-sm transition-all sm:rounded-xl"
              />
              <Button
                size="lg"
                className="h-[54px] rounded-2xl bg-white px-8 text-[15px] font-bold text-primary shadow-xl shadow-black/10 transition-all hover:bg-white/95 hover:shadow-2xl sm:rounded-xl"
              >
                <Bell className="mr-2 h-4 w-4" />
                {t("cta")}
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
