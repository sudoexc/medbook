"use client";

/**
 * Phase G1 — drug catalog drawer.
 *
 * Opens as a side panel from the prescriptions field. Search hits
 * `GET /api/crm/catalogs/drugs?q=`; clicking a result reveals a detail
 * panel with forms, indications, contraindications, side effects,
 * pregnancy category, and a one-click "insert into prescriptions" action.
 * Ф2 — the pick hands the full drug record to the caller, which builds a
 * structured VisitPrescription row (form/strength/instruction auto-filled).
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BabyIcon,
  BookOpenIcon,
  CheckIcon,
  PillIcon,
  SearchIcon,
  StarIcon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import { useDoctorFavorites } from "../_hooks/use-doctor-favorites";

// Mirror of the API response shape (kept inline — small, evolves together).
type DrugForm = { form: string; strengths: string[] };
type DrugBrand = { id: string; name: string; manufacturer: string | null };
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
const CATEGORY_KEY: Record<string, string> = {
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
const FORM_KEY: Record<string, string> = {
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

const PREGNANCY_TONE: Record<DrugDetail["pregnancyCat"], string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-emerald-100 text-emerald-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-red-100 text-red-800",
  X: "bg-red-200 text-red-900 font-bold",
  UNKNOWN: "bg-muted text-muted-foreground",
};

// Resolve a server category enum to its localized label, falling back to the
// raw enum string for codes not yet in the catalog.
function useCategoryLabel() {
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
function useFormLabel() {
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

async function fetchDrugs(q: string): Promise<DrugDetail[]> {
  const url = `/api/crm/catalogs/drugs?q=${encodeURIComponent(q)}&limit=60`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Catalog ${res.status}`);
  const data = (await res.json()) as { rows: DrugDetail[] };
  return data.rows ?? [];
}

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /**
   * Called when the user picks a drug. Ф2 — the caller builds a structured
   * VisitPrescription draft from the full drug record (forms/defaultDosing).
   */
  onPick: (drug: DrugDetail) => void;
};

export function CatalogDrawer({ open, onOpenChange, onPick }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const categoryLabel = useCategoryLabel();
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);

  const drugsQuery = useQuery({
    queryKey: ["catalog-drugs", query],
    queryFn: () => fetchDrugs(query),
    enabled: open,
    staleTime: 60_000,
  });

  const { pinned, toggle } = useDoctorFavorites("DRUG");

  // Reset query on close.
  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedId(null);
      setFavoritesOnly(false);
    }
  }, [open]);

  const rawRows = drugsQuery.data ?? [];
  const filteredRows = favoritesOnly
    ? rawRows.filter((r) => pinned.has(r.id))
    : rawRows;
  // Float pinned favourites to the top so the doctor's go-to picks stay one
  // tap away. Within each bucket we keep the API order (which already ranks
  // by INN match / brand / prefix — see drugs route ranker).
  const rows = React.useMemo(() => {
    if (pinned.size === 0) return filteredRows;
    const pin: typeof filteredRows = [];
    const rest: typeof filteredRows = [];
    for (const r of filteredRows) (pinned.has(r.id) ? pin : rest).push(r);
    return [...pin, ...rest];
  }, [filteredRows, pinned]);

  // Auto-select first result when results refresh.
  React.useEffect(() => {
    if (rows.length === 0) {
      setSelectedId(null);
    } else if (!selectedId || !rows.some((r) => r.id === selectedId)) {
      setSelectedId(rows[0]!.id);
    }
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const handlePick = (drug: DrugDetail) => {
    onPick(drug);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("catalog.title")}</DialogTitle>
          <DialogDescription>
            {t("catalog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-[600px] max-h-[80vh] flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-2.5">
            <SearchIcon className="size-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("catalog.searchPlaceholder")}
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setFavoritesOnly((v) => !v)}
              title={favoritesOnly ? t("catalog.showAll") : t("catalog.favoritesOnly")}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] transition-colors",
                favoritesOnly
                  ? "border-amber-300 bg-amber-50 text-amber-700"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              <StarIcon
                className={cn(
                  "size-3.5",
                  favoritesOnly ? "fill-amber-400 text-amber-500" : "",
                )}
              />
              {pinned.size}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t("actions.close")}
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* List */}
            <div className="w-1/2 overflow-y-auto border-r">
              {drugsQuery.isLoading && rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {t("common.loading")}
                </div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  {query.trim()
                    ? t("catalog.notFound")
                    : t("catalog.typeToSearch")}
                </div>
              ) : (
                <ul className="p-1">
                  {rows.map((d) => {
                    const isPinned = pinned.has(d.id);
                    return (
                      <li key={d.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => setSelectedId(d.id)}
                          className={cn(
                            "w-full rounded-md px-2 py-1.5 pr-8 text-left transition-colors",
                            selectedId === d.id
                              ? "bg-primary/10"
                              : "hover:bg-muted",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-medium text-foreground">
                              {isPinned ? (
                                <StarIcon className="size-3 shrink-0 fill-amber-400 text-amber-500" />
                              ) : null}
                              <span className="truncate">{d.nameRu}</span>
                            </span>
                            <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                              {categoryLabel(d.category)}
                            </span>
                          </div>
                          {d.brands.length > 0 ? (
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {d.brands.map((b) => b.name).join(", ")}
                            </div>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(d.id);
                          }}
                          title={isPinned ? t("favorites.remove") : t("favorites.add")}
                          className={cn(
                            "absolute right-1.5 top-1.5 inline-flex size-6 items-center justify-center rounded-md transition-colors",
                            isPinned
                              ? "text-amber-500 hover:bg-amber-100"
                              : "text-muted-foreground/40 opacity-0 hover:bg-muted hover:text-amber-500 group-hover:opacity-100",
                          )}
                        >
                          <StarIcon
                            className={cn(
                              "size-3.5",
                              isPinned ? "fill-amber-400" : "",
                            )}
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Detail */}
            <div className="flex w-1/2 flex-col overflow-y-auto">
              {selected ? (
                <DrugDetailView drug={selected} onPick={() => handlePick(selected)} />
              ) : (
                <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
                  {t("catalog.selectDrug")}
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DrugDetailView({
  drug,
  onPick,
}: {
  drug: DrugDetail;
  onPick: () => void;
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
            {!drug.rxOnly ? (
              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase text-emerald-800">
                OTC
              </span>
            ) : (
              <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] uppercase text-blue-800">
                Rx
              </span>
            )}
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
            <ul className="space-y-0.5 text-muted-foreground">
              {drug.contraindications.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <span className="select-none">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {drug.sideEffects.length > 0 ? (
          <Section title={t("catalog.sections.sideEffects")}>
            <ul className="space-y-0.5 text-muted-foreground">
              {drug.sideEffects.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <span className="select-none">•</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
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

      <div className="border-t bg-muted/40 px-4 py-2.5">
        <Button onClick={onPick} className="w-full" size="sm">
          <CheckIcon className="mr-1 size-3.5" />
          {t("catalog.addToPrescriptions")}
        </Button>
      </div>
    </>
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
