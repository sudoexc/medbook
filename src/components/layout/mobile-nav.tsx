"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { NAV_LINKS } from "@/lib/constants";
import { LanguageSwitcher } from "./language-switcher";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("nav");

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button className="lg:hidden p-2" aria-label="Menu">
            <Menu className="h-6 w-6" />
          </button>
        }
      />
      <SheetContent side="right" className="w-72 pt-12">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <nav className="flex flex-col gap-6 px-4">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-lg font-medium text-foreground/80 hover:text-foreground transition-colors"
            >
              {t(link.labelKey.replace("nav.", "") as "doctors" | "services" | "about" | "faq")}
            </a>
          ))}
          <div className="border-t border-border pt-6">
            <LanguageSwitcher />
          </div>
          <Button size="lg" className="w-full bg-primary text-primary-foreground font-semibold hover:bg-primary/85">
            {t("bookAppointment")}
          </Button>
        </nav>
      </SheetContent>
    </Sheet>
  );
}
