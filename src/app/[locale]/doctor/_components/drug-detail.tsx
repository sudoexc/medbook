"use client";

// Shared drug presentation card used by the reception catalog drawer (with an
// "add to prescriptions" footer) and the read-only references browser. Labels
// resolve under `doctor.receptionDialogs.catalog.*` so both surfaces stay in sync.
import * as React from "react";
import { useTranslations } from "next-intl";
import { AlertTriangleIcon, BabyIcon, PillIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Mirror of the API response shape (kept inline — small, evolves together).
export type DrugForm = { form: string; strengths: string[] };
export type DrugBrand = { id: string; name: string; manufacturer: string | null };
export type DrugDetail = {
  id: string;
  inn: string;
  nameRu: string;
  nameUz: string | null;
  atcCode: string | null;
  category: string;
  forms: DrugForm[];
  indications: string[];
  contraindications: string[];
  sideEffects: string[];
  pregnancyCat: "A" | "B" | "C" | "D" | "X" | "UNKNOWN";
  defaultDosing: {
    adult?: string;
    pediatric?: string;
    renal?: string;
    elderly?: string;
  } | null;
  rxOnly: boolean;
  active: boolean;
  brands: DrugBrand[];
};

// Enum → i18n key suffix under `catalog.categories.*`. Display labels live in
// the message catalog; this map only routes the server enum to its key.
export const CATEGORY_KEY: Record<string, string> = {
  ANTIBIOTIC: "antibiotic",
  ANALGESIC: "analgesic",
  ANTIPYRETIC: "antipyretic",
  NSAID: "nsaid",
  ANTIHISTAMINE: "antihistamine",
  GI: "gi",
  CARDIO: "cardio",
  RESPIRATORY: "respiratory",
  VITAMIN: "vitamin",
  SEDATIVE: "sedative",
  ENDOCRINE: "endocrine",
  DIURETIC: "diuretic",
  ANTIEMETIC: "antiemetic",
  ANTISPASMODIC: "antispasmodic",
  STEROID: "steroid",
  TOPICAL: "topical",
  EYE_EAR: "eyeEar",
  UROLOGY: "urology",
  NEUROLOGICAL: "neurological",
  PSYCHIATRIC: "psychiatric",
  ANTIFUNGAL: "antifungal",
  ANTIVIRAL: "antiviral",
  HORMONAL: "hormonal",
  DERMATOLOGICAL: "dermatological",
  HEMATOLOGY: "hematology",
  OPHTHALMIC: "ophthalmic",
  GYNECOLOGY: "gynecology",
  VACCINE: "vaccine",
  OTHER: "other",
};

// Enum → i18n key suffix under `catalog.forms.*`.
export const FORM_KEY: Record<string, string> = {
  TAB: "tab",
  CAP: "cap",
  SYRUP: "syrup",
  POWDER: "powder",
  INHAL: "inhal",
  INJ_IM: "injIm",
  INJ_IV: "injIv",
  DROPS_ORAL: "dropsOral",
  DROPS_EYE: "dropsEye",
  DROPS_EAR: "dropsEar",
  SUPP_RECT: "suppRect",
  GEL: "gel",
  CREAM: "cream",
  OINT: "oint",
};

export function RxBadge({ rxOnly }: { rxOnly: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[10px] uppercase",
        rxOnly ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800",
      )}
    >
      {rxOnly ? "Rx" : "OTC"}
    </span>
  );
}

export const PREGNANCY_TONE: Record<DrugDetail["pregnancyCat"], string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-emerald-100 text-emerald-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-red-100 text-red-800",
  X: "bg-red-200 text-red-900 font-bold",
  UNKNOWN: "bg-muted text-muted-foreground",
};

// Resolve a server category enum to its localized label, falling back to the
// raw enum string for codes not yet in the catalog.
export function useCategoryLabel() {
  const t = useTranslations("doctor.receptionDialogs");
  return React.useCallback(
    (category: string) => {
      const key = CATEGORY_KEY[category];
      return key && t.has(`catalog.categories.${key}`)
        ? t(`catalog.categories.${key}`)
        : category;
    },
    [t],
  );
}

// Resolve a server form enum to its localized short label.
export function useFormLabel() {
  const t = useTranslations("doctor.receptionDialogs");
  return React.useCallback(
    (form: string) => {
      const key = FORM_KEY[form];
      return key && t.has(`catalog.forms.${key}`)
        ? t(`catalog.forms.${key}`)
        : form;
    },
    [t],
  );
}

export function DrugDetailView({
  drug,
  footer,
}: {
  drug: DrugDetail;
  /** Optional action area pinned to the bottom (e.g. "add to prescriptions"). */
  footer?: React.ReactNode;
}) {
  const t = useTranslations("doctor.receptionDialogs");
  const categoryLabel = useCategoryLabel();
  const formLabel = useFormLabel();
  return (
    <>
      <div className="flex items-start gap-3 border-b px-4 py-3">
        <div className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PillIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-tight text-foreground">
            {drug.nameRu}
          </div>
          {drug.inn && drug.inn.toLowerCase() !== drug.nameRu.toLowerCase() ? (
            <div className="text-xs italic text-muted-foreground">{drug.inn}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
              {categoryLabel(drug.category)}
            </span>
            {drug.atcCode ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                {drug.atcCode}
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] uppercase",
                PREGNANCY_TONE[drug.pregnancyCat],
              )}
              title={t("catalog.pregnancyCategory")}
            >
              <BabyIcon className="mr-0.5 inline size-2.5" />
              {drug.pregnancyCat}
            </span>
            <RxBadge rxOnly={drug.rxOnly} />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 px-4 py-3 text-xs">
        {drug.forms.length > 0 ? (
          <Section title={t("catalog.sections.forms")}>
            <ul className="space-y-0.5">
              {drug.forms.map((f) => (
                <li key={f.form}>
                  <span className="font-medium text-foreground">
                    {formLabel(f.form)}
                  </span>
                  {": "}
                  <span className="text-muted-foreground">
                    {f.strengths.join(" / ")}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {drug.defaultDosing &&
        (drug.defaultDosing.adult ||
          drug.defaultDosing.pediatric ||
          drug.defaultDosing.elderly ||
          drug.defaultDosing.renal) ? (
          <Section title={t("catalog.sections.standardDoses")}>
            <ul className="space-y-1">
              {drug.defaultDosing.adult ? (
                <li>
                  <span className="font-medium text-foreground">{t("catalog.dosing.adult")}</span>{" "}
                  <span className="text-muted-foreground">
                    {drug.defaultDosing.adult}
                  </span>
                </li>
              ) : null}
              {drug.defaultDosing.pediatric ? (
                <li>
                  <span className="font-medium text-foreground">{t("catalog.dosing.pediatric")}</span>{" "}
                  <span className="text-muted-foreground">
                    {drug.defaultDosing.pediatric}
                  </span>
                </li>
              ) : null}
              {drug.defaultDosing.elderly ? (
                <li>
                  <span className="font-medium text-foreground">{t("catalog.dosing.elderly")}</span>{" "}
                  <span className="text-muted-foreground">
                    {drug.defaultDosing.elderly}
                  </span>
                </li>
              ) : null}
              {drug.defaultDosing.renal ? (
                <li>
                  <span className="font-medium text-foreground">{t("catalog.dosing.renal")}</span>{" "}
                  <span className="text-muted-foreground">
                    {drug.defaultDosing.renal}
                  </span>
                </li>
              ) : null}
            </ul>
          </Section>
        ) : null}

        {drug.contraindications.length > 0 ? (
          <Section
            title={t("catalog.sections.contraindications")}
            Icon={AlertTriangleIcon}
            tone="warn"
          >
            <BulletList items={drug.contraindications} />
          </Section>
        ) : null}

        {drug.sideEffects.length > 0 ? (
          <Section title={t("catalog.sections.sideEffects")}>
            <BulletList items={drug.sideEffects} />
          </Section>
        ) : null}

        {drug.brands.length > 0 ? (
          <Section title={t("catalog.sections.brands")}>
            <div className="flex flex-wrap gap-1">
              {drug.brands.map((b) => (
                <span
                  key={b.id}
                  className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground"
                >
                  {b.name}
                </span>
              ))}
            </div>
          </Section>
        ) : null}
      </div>

      {footer ? (
        <div className="border-t bg-muted/40 px-4 py-2.5">{footer}</div>
      ) : null}
    </>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-0.5 text-muted-foreground">
      {items.map((c) => (
        <li key={c} className="flex gap-1.5">
          <span className="select-none">•</span>
          <span>{c}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  Icon,
  tone,
  children,
}: {
  title: string;
  Icon?: typeof AlertTriangleIcon;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide",
          tone === "warn" ? "text-amber-700" : "text-foreground",
        )}
      >
        {Icon ? <Icon className="size-3" /> : null}
        {title}
      </div>
      {children}
    </div>
  );
}
