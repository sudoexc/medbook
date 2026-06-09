import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";

import { ConclusionDetail } from "./_components/conclusion-detail";

export default async function ConclusionDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations("doctor.conclusions");
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <Link
        href={`/${locale}/doctor/conclusions`}
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        {t("detail.backToList")}
      </Link>

      <ConclusionDetail noteId={id} locale={locale} />
    </div>
  );
}
