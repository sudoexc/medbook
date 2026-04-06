"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { SPECIALTIES } from "@/lib/constants";
import { CheckCircle, Send } from "lucide-react";
import type { Locale } from "@/types";

export function LeadFormTrigger({ children }: { children: React.ReactElement }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const t = useTranslations("leadForm");
  const locale = useLocale() as Locale;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setOpen(false);
    }, 2500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={children} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{t("title")}</DialogTitle>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </DialogHeader>

        {submitted ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
              <CheckCircle className="h-7 w-7 text-accent" />
            </div>
            <p className="text-center font-medium">{t("success")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-2 space-y-4">
            <div>
              <label className="text-sm font-medium">{t("name")}</label>
              <Input
                required
                className="mt-1.5 h-11"
                placeholder={t("name")}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("phone")}</label>
              <Input
                required
                type="tel"
                className="mt-1.5 h-11"
                placeholder={t("phoneFormat")}
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("specialty")}</label>
              <select
                className="mt-1.5 flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">{t("selectSpecialty")}</option>
                {SPECIALTIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name[locale]}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
            >
              <Send className="mr-2 h-4 w-4" />
              {t("submit")}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
