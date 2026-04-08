import { useTranslations } from "next-intl";
import { Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { ScrollToButton } from "@/components/ui/scroll-to-button";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="bg-[#eef4f9] border-b border-border">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl leading-[1.15]">
            {t("title")}
          </h1>

          <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
            {t("subtitle")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LeadFormTrigger>
              <Button className="h-12 rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/85">
                {t("cta")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </LeadFormTrigger>
            <ScrollToButton targetId="doctors">
              <Button
                variant="outline"
                className="h-12 rounded-lg px-6 text-base font-medium border-border text-foreground hover:bg-muted"
              >
                <Search className="mr-2 h-4 w-4" />
                {t("ctaSecondary")}
              </Button>
            </ScrollToButton>
          </div>

          <div className="mt-10 flex flex-wrap gap-6 text-sm text-muted-foreground">
            <span>{t("stats.clients")}</span>
            <span className="text-border">|</span>
            <span>{t("stats.experience")}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
