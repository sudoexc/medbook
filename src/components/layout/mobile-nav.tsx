"use client";

import { useRef, useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { NAV_LINKS } from "@/lib/constants";
import type { SiteSection } from "@/lib/site-nav";
import { createLeadFormHandle, LeadFormTrigger } from "@/components/sections/lead-form";
import { LanguageSwitcher } from "./language-switcher";
import { SiteSectionLink, useOnSiteHome } from "./site-section-link";

/** Jump to a landing section and name it in the address bar, like an anchor does. */
function scrollToSection(section: SiteSection) {
  const target = document.getElementById(section);
  if (!target) return;
  target.scrollIntoView({ block: "start" });
  // Keep the router's own history state; only the hash changes.
  window.history.replaceState(window.history.state, "", `#${section}`);
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const t = useTranslations("nav");
  const onHome = useOnSiteHome();
  // The booking form lives outside the sheet: the sheet unmounts its content
  // when it closes, and a form owned by a button inside it would vanish with
  // it. «Записаться» here used to be a bare Button with no handler at all,
  // so the phone menu could not book (audit CM-14).
  const [leadForm] = useState(createLeadFormHandle);
  // What to do once the sheet has fully closed. Opening the form while the
  // sheet is still up has two modal dialogs fighting over focus, and a jump
  // made under the sheet's scroll lock can be undone when the lock releases
  // (with classic scrollbars it puts the old scroll position back).
  const afterClose = useRef<(() => void) | null>(null);

  function closeThen(action: () => void) {
    afterClose.current = action;
    setOpen(false);
  }

  function handleOpenChange(isOpen: boolean) {
    // A close that was not ours (backdrop, Escape) must not run a stale action.
    if (isOpen) afterClose.current = null;
    setOpen(isOpen);
  }

  function handleOpenChangeComplete(isOpen: boolean) {
    if (isOpen) return;
    const action = afterClose.current;
    afterClose.current = null;
    action?.();
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={handleOpenChange}
        onOpenChangeComplete={handleOpenChangeComplete}
      >
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
              <SiteSectionLink
                key={link.section}
                section={link.section}
                onClick={(e) => {
                  // Another page: the browser loads the landing at the
                  // section, nothing to wait for.
                  if (!onHome) {
                    setOpen(false);
                    return;
                  }
                  e.preventDefault();
                  closeThen(() => scrollToSection(link.section));
                }}
                className="text-lg font-medium text-foreground/80 hover:text-foreground transition-colors"
              >
                {t(link.labelKey.replace("nav.", "") as "doctors" | "services" | "visit" | "faq")}
              </SiteSectionLink>
            ))}
            <div className="border-t border-border pt-6">
              <LanguageSwitcher />
            </div>
            <Button
              size="lg"
              onClick={() => closeThen(() => leadForm.open(null))}
              className="w-full bg-primary text-primary-foreground font-semibold hover:bg-primary/85"
            >
              {t("bookAppointment")}
            </Button>
          </nav>
        </SheetContent>
      </Sheet>
      {/* Opening through the handle runs the form's own open handler, so the
          booking-open goal fires exactly as for every other «Записаться». */}
      <LeadFormTrigger handle={leadForm} />
    </>
  );
}
