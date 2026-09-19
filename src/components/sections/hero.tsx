import { useTranslations } from "next-intl";
import { Search, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LeadFormTrigger } from "@/components/sections/lead-form";
import { ScrollToButton } from "@/components/ui/scroll-to-button";

export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="border-b border-border bg-[#eef4f9]">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
            {t("title")}
          </h1>

          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            {t("subtitle")}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LeadFormTrigger>
              <Button className="h-11 rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground hover:bg-primary/85">
                {t("cta")}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </LeadFormTrigger>
            <ScrollToButton targetId="doctors">
              <Button
                variant="outline"
                className="h-11 rounded-lg border-border px-6 text-base font-medium text-foreground hover:bg-muted"
              >
                <Search className="mr-2 h-4 w-4" />
                {t("ctaSecondary")}
              </Button>
            </ScrollToButton>
          </div>
        </div>
      </div>
    </section>
  );
}
