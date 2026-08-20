import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftIcon } from "lucide-react";

import { ActiveAIRail } from "./_components/active-ai-rail";
import { ActivePatientCard } from "./_components/active-patient-card";
import { SessionTabContent } from "./_components/session-tab-content";
import { SessionTabs } from "./_components/session-tabs";
import { ReceptionProvider } from "./_hooks/reception-context";

export default async function ReceptionPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("doctor.reception");
  return (
    <ReceptionProvider>
      <div className="flex gap-4 p-4 xl:gap-5 xl:p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4 xl:gap-5">
          <Link
            href={`/${locale}/doctor/patients`}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ArrowLeftIcon className="size-4" />
            {t("page.backToList")}
          </Link>

          {/* Consultation screen = patient + tabs + the visit itself, nothing
              below it (design feedback — «проще»). The old bottom row of four
              cards re-showed what the tabs already hold: «Документы» and
              «Недавние файлы» duplicated the Документы/Анализы tabs, «История
              диагнозов» moved into the История tab, and «Черновики
              заключений» wasn't even about this patient — it lives in the
              Заключения section. */}
          <ActivePatientCard />
          <SessionTabs />
          <SessionTabContent locale={locale} />
        </div>

        <div className="hidden xl:block">
          <ActiveAIRail />
        </div>
      </div>
    </ReceptionProvider>
  );
}
