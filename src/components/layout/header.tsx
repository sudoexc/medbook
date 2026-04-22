"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { NAV_LINKS } from "@/lib/constants";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { Button } from "@/components/ui/button";

export function Header() {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex items-center">
          <Image
            src="/logo.png"
            alt="NeuroFax-B"
            width={103}
            height={40}
            priority
          />
        </a>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.labelKey.replace("nav.", "") as "doctors" | "services" | "about" | "faq")}
            </a>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-3">
          <LanguageSwitcher />
          <LeadFormTrigger>
            <Button className="h-9 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/85">
              {t("bookAppointment")}
            </Button>
          </LeadFormTrigger>
        </div>

        {/* Mobile */}
        <MobileNav />
      </div>
    </header>
  );
}
