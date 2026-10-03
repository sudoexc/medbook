import { getTranslations } from "next-intl/server";

import { ArsenalEditor } from "@/components/arsenal/arsenal-editor";

/**
 * /doctor/arsenal — «Мой арсенал» (owner request 03.10.2026): the drugs and
 * diagnoses this doctor reaches for every day, in his order, each drug with
 * his usual schema. The visit screen's «Мои» column is this list. The
 * cabinet layout already admits doctors only; the API checks it again.
 */
export default async function DoctorArsenalPage() {
  const t = await getTranslations("doctor.arsenal");
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t("page.title")}</h1>
        <p className="max-w-3xl text-sm leading-snug text-muted-foreground">
          {t("page.subtitle")}
        </p>
      </div>
      <ArsenalEditor />
    </div>
  );
}
