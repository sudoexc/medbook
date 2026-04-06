"use client";

import { useTranslations } from "next-intl";
import { ShieldCheck, MessageSquare, Clock, Wallet } from "lucide-react";
import { motion } from "framer-motion";

const items = [
  { icon: ShieldCheck, key: "verified" as const, gradient: "from-blue-500 to-blue-600", bg: "bg-blue-50" },
  { icon: MessageSquare, key: "reviews" as const, gradient: "from-emerald-500 to-emerald-600", bg: "bg-emerald-50" },
  { icon: Clock, key: "anytime" as const, gradient: "from-violet-500 to-violet-600", bg: "bg-violet-50" },
  { icon: Wallet, key: "free" as const, gradient: "from-amber-500 to-amber-600", bg: "bg-amber-50" },
];

export function Advantages() {
  const t = useTranslations("advantages");

  return (
    <section className="py-24 sm:py-32">
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

        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:gap-6">
          {items.map((item, i) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group relative overflow-hidden rounded-2xl border border-border/40 bg-white p-7 transition-all duration-300 hover:border-transparent hover:shadow-xl hover:shadow-black/[0.06]"
            >
              <div className="flex gap-5">
                <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${item.gradient} shadow-md`}>
                  <item.icon className="h-7 w-7 text-white" strokeWidth={1.5} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">{t(`${item.key}.title`)}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
                    {t(`${item.key}.description`)}
                  </p>
                </div>
              </div>
              {/* Subtle hover gradient */}
              <div className={`absolute inset-0 -z-10 ${item.bg} opacity-0 transition-opacity duration-300 group-hover:opacity-30`} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
