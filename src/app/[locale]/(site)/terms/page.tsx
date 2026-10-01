import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { siteOpenGraph } from "@/lib/site-meta";
import { siteAlternates } from "@/lib/site-urls";

// No `dynamic` override (audit LD-04): the page inherits the (site)
// layout's force-dynamic. It used to say force-static, which won over the
// layout, so the page was rendered once after a deploy and kept: the booking
// form in the header listed the doctors of that moment until the next
// deploy (or none at all if the database was not up yet), and the footer
// year froze with it.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  // Its own canonical and hreflang (audit LD-03): it used to inherit the
  // landing's and tell search engines the landing was its canonical page.
  return {
    title: t("title"),
    alternates: siteAlternates(locale, "/terms"),
    openGraph: siteOpenGraph(locale, "/terms", { title: t("title") }),
  };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.terms" });
  const sections = [
    "intro",
    "services",
    "booking",
    "payment",
    "cancellation",
    "liability",
    "changes",
    "contact",
  ] as const;
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="mb-2 text-3xl font-bold text-foreground">{t("title")}</h1>
      <p className="mb-10 text-sm text-muted-foreground">{t("updated")}</p>
      <div className="space-y-8 text-[15px] leading-relaxed text-foreground">
        {sections.map((key) => (
          <section key={key}>
            <h2 className="mb-2 text-xl font-semibold">{t(`${key}.title`)}</h2>
            <p className="whitespace-pre-line text-muted-foreground">
              {t(`${key}.body`)}
            </p>
          </section>
        ))}
      </div>
    </main>
  );
}
