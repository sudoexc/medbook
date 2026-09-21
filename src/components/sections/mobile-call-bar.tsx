"use client";

import { useTranslations } from "next-intl";
import { PhoneIcon } from "lucide-react";

import { CONTACT } from "@/lib/constants";
import { LeadFormTrigger } from "./lead-form";

/**
 * Sticky bottom action bar, phones only. For a local clinic the call IS the
 * conversion — it must be one thumb-tap away at any scroll position. The
 * spacer div keeps the fixed bar from covering the footer's last rows.
 */
export function MobileCallBar() {
  const t = useTranslations("mobileBar");

  return (
    <>
      <div aria-hidden className="h-16 lg:hidden" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-white/95 px-3 py-2.5 backdrop-blur-sm lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <a
            href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground"
          >
            <PhoneIcon className="h-4 w-4" />
            {t("call")}
          </a>
          <LeadFormTrigger>
            <button
              type="button"
              className="flex h-11 flex-1 items-center justify-center rounded-xl border border-border bg-white text-base font-semibold text-foreground"
            >
              {t("request")}
            </button>
          </LeadFormTrigger>
        </div>
      </div>
    </>
  );
}
