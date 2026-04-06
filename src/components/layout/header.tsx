"use client";

import { useTranslations } from "next-intl";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV_LINKS } from "@/lib/constants";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";
import { LeadFormTrigger } from "@/components/sections/lead-form";

export function Header() {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md shadow-primary/20 transition-transform group-hover:scale-105">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <span className="text-[22px] font-extrabold tracking-tight text-foreground">
            Med<span className="text-primary">Book</span>
          </span>
        </a>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-4 py-2 text-[15px] font-medium text-foreground/60 transition-all hover:text-foreground hover:bg-foreground/5"
            >
              {t(link.labelKey.replace("nav.", "") as "howItWorks" | "specialties" | "forDoctors" | "faq")}
            </a>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-4">
          <LanguageSwitcher />
          <LeadFormTrigger>
            <Button className="h-10 rounded-xl bg-gradient-to-r from-primary to-primary/90 px-6 text-[15px] font-semibold text-white shadow-md shadow-primary/25 transition-all hover:shadow-lg hover:shadow-primary/30 hover:brightness-110">
              {t("findDoctor")}
            </Button>
          </LeadFormTrigger>
        </div>

        {/* Mobile */}
        <MobileNav />
      </div>
    </header>
  );
}
