import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

export default async function LocaleNotFound() {
  const locale = await getLocale();
  let title = "Страница не найдена";
  let description = "Запрошенная страница не существует или была перемещена.";
  let homeLabel = "На главную";

  try {
    const t = await getTranslations("notFound");
    title = t("title");
    description = t("description");
    homeLabel = t("home");
  } catch {
    if (locale === "uz") {
      title = "Sahifa topilmadi";
      description = "So'ralgan sahifa mavjud emas yoki ko'chirilgan.";
      homeLabel = "Bosh sahifaga";
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-7xl font-bold tracking-tight text-primary">404</p>
      <h1 className="mt-4 text-2xl font-bold sm:text-3xl">{title}</h1>
      <p className="mt-3 max-w-md text-muted-foreground">{description}</p>
      <Link
        href={`/${locale}`}
        className="mt-8 inline-flex items-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        {homeLabel}
      </Link>
    </main>
  );
}
