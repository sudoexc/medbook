import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-static";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  return { title: t("title") };
}

export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "legal.privacy" });
  const sections = [
    "intro",
    "data",
    "use",
    "share",
    "storage",
    "rights",
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
