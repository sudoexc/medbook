import { getTranslations } from "next-intl/server";

import { Icd10Browser } from "./_components/icd10-browser";

export default async function ReferencesPage() {
  const t = await getTranslations("doctor.references");
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {t("page.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("page.subtitle")}
          </p>
        </div>
      </div>

      <Icd10Browser />
    </div>
  );
}
