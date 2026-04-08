import { useTranslations } from "next-intl";
import { Phone, Send, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "./lead-form";
import { CONTACT } from "@/lib/constants";

export function Cta() {
  const t = useTranslations("nav");

  return (
    <section className="py-16 sm:py-20 bg-[#f8f9fa]">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rounded-xl border border-border bg-white p-8 sm:p-12 text-center">
          <h2 className="text-2xl font-bold text-foreground sm:text-3xl">
            {t("bookAppointment")}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {CONTACT.phone}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <LeadFormTrigger>
              <Button className="h-11 rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground hover:bg-primary/85">
                {t("bookAppointment")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </LeadFormTrigger>

            <a href={`tel:${CONTACT.phone.replace(/\s/g, "")}`}>
              <Button variant="outline" className="h-11 rounded-lg px-6 text-sm font-medium border-border hover:bg-muted w-full sm:w-auto">
                <Phone className="mr-2 h-4 w-4" />
                {CONTACT.phone}
              </Button>
            </a>

            {CONTACT.telegram !== "#" && (
              <a href={CONTACT.telegram} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" className="h-11 rounded-lg px-6 text-sm font-medium border-border hover:bg-muted w-full sm:w-auto">
                  <Send className="mr-2 h-4 w-4" />
                  Telegram
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
