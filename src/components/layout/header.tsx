"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { Phone } from "lucide-react";
import { CONTACT, NAV_LINKS } from "@/lib/constants";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";
import { SiteSectionLink } from "./site-section-link";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { Button } from "@/components/ui/button";

export function Header() {
  const t = useTranslations("nav");

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-white">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <a href="/" className="flex items-center">
          <Image
            src="/logo.png"
            alt="NeuroFax-B"
            width={118}
            height={46}
            priority
          />
        </a>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {NAV_LINKS.map((link) => (
            <SiteSectionLink
              key={link.section}
              section={link.section}
              className="px-3 py-2 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.labelKey.replace("nav.", "") as "doctors" | "services" | "visit" | "faq")}
            </SiteSectionLink>
          ))}
        </nav>

        {/* Desktop Actions */}
        <div className="hidden lg:flex items-center gap-4">
          <a
            href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
            className="hidden items-center gap-2 text-base font-semibold text-foreground transition-colors hover:text-primary xl:inline-flex"
          >
            <Phone className="h-4 w-4 text-primary" />
            {CONTACT.phone}
          </a>
          <LanguageSwitcher />
          <LeadFormTrigger>
            <Button className="h-10 rounded-lg bg-primary px-6 text-[15px] font-semibold text-primary-foreground hover:bg-primary/85">
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
