import { Icd10Browser } from "./_components/icd10-browser";

export default function ReferencesPage() {
  return (
    <div className="flex flex-col gap-4 p-4 xl:gap-5 xl:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Справочник МКБ-10
          </h1>
          <p className="text-sm text-muted-foreground">
            Поиск по коду или диагнозу. Клик по строке — копирует в буфер.
          </p>
        </div>
      </div>

      <Icd10Browser />
    </div>
  );
}
