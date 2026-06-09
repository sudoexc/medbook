"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { PillIcon, SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DRUG_CATEGORY_LABELS_RU,
  DRUGS_BY_ID,
  searchDrugs,
  type Drug,
  type DrugFormVariant,
} from "@/lib/catalogs/drugs";
import {
  DURATION_QUICK_PICKS,
  FORM_LABELS_RU,
  FREQ_LABELS_RU,
  TIMING_LABELS_RU,
  formatDosageRu,
  type DrugForm,
  type Frequency,
  type Timing,
} from "@/lib/catalogs/dosage";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onAdd: (composed: string) => void;
};

const FREQ_ORDER: Frequency[] = [
  "1x_day",
  "2x_day",
  "3x_day",
  "4x_day",
  "every_4h",
  "every_6h",
  "every_8h",
  "every_12h",
  "every_other_day",
  "weekly",
  "as_needed",
  "single",
];

const TIMING_ORDER: Timing[] = [
  "after_meal",
  "before_meal",
  "with_meal",
  "empty",
  "morning",
  "evening",
  "bedtime",
  "any",
];

// Timing → i18n key suffix under `dosageBuilder.timing.*`. The display labels
// live in the message catalog; this map only routes the enum to its key.
const TIMING_KEY: Record<Timing, string> = {
  before_meal: "beforeMeal",
  after_meal: "afterMeal",
  with_meal: "withMeal",
  empty: "empty",
  morning: "morning",
  evening: "evening",
  bedtime: "bedtime",
  any: "any",
};

/**
 * Manual dosage builder — doctor walks drug → form → dose → frequency →
 * timing → duration; preview line updates live. On "Добавить" we pass the
 * composed string up so the caller can drop it into prescriptions[].
 */
export function DosageBuilderDialog({ open, onOpenChange, onAdd }: Props) {
  const t = useTranslations("doctor.receptionDialogs");
  const defaultDuration = t("dosageBuilder.defaultDuration");
  const [query, setQuery] = React.useState("");
  const [drugId, setDrugId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<DrugForm | null>(null);
  const [dose, setDose] = React.useState("");
  const [customDose, setCustomDose] = React.useState(false);
  const [frequency, setFrequency] = React.useState<Frequency>("3x_day");
  const [timing, setTiming] = React.useState<Timing>("after_meal");
  const [duration, setDuration] = React.useState(defaultDuration);
  const [note, setNote] = React.useState("");

  const reset = React.useCallback(() => {
    setQuery("");
    setDrugId(null);
    setForm(null);
    setDose("");
    setCustomDose(false);
    setFrequency("3x_day");
    setTiming("after_meal");
    setDuration(defaultDuration);
    setNote("");
  }, [defaultDuration]);

  // Reset whenever the dialog closes — next open is a fresh prescription.
  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  const drug: Drug | null = drugId ? DRUGS_BY_ID[drugId] ?? null : null;
  const currentVariant: DrugFormVariant | null = React.useMemo(() => {
    if (!drug || !form) return null;
    return drug.forms.find((f) => f.form === form) ?? null;
  }, [drug, form]);

  const composed = React.useMemo(() => {
    if (!drug || !form) return "";
    return formatDosageRu({
      drugName: drug.nameRu,
      form,
      dose: dose.trim(),
      frequency,
      timing,
      duration,
      note: note.trim() || undefined,
    });
  }, [drug, form, dose, frequency, timing, duration, note]);

  const canSubmit = !!drug && !!form && !!dose.trim();

  const submit = () => {
    if (!canSubmit) return;
    onAdd(composed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PillIcon className="size-5 text-primary" />
            {t("dosageBuilder.title")}
          </DialogTitle>
          <DialogDescription>
            {t("dosageBuilder.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* ── 1. Drug picker ── */}
          <DrugPicker
            query={query}
            onQueryChange={setQuery}
            drug={drug}
            onPick={(d) => {
              setDrugId(d.id);
              setQuery("");
              const firstForm = d.forms[0] ?? null;
              setForm(firstForm?.form ?? null);
              setDose(firstForm?.doses[0] ?? "");
              setCustomDose(false);
            }}
            onClear={() => {
              setDrugId(null);
              setForm(null);
              setDose("");
              setCustomDose(false);
            }}
          />

          {/* ── 2. Form ── */}
          {drug && drug.forms.length > 0 && (
            <Section label={t("dosageBuilder.form")}>
              <ChipRow>
                {drug.forms.map((variant) => (
                  <Chip
                    key={variant.form}
                    active={form === variant.form}
                    onClick={() => {
                      setForm(variant.form);
                      setDose(variant.doses[0] ?? "");
                      setCustomDose(false);
                    }}
                  >
                    {FORM_LABELS_RU[variant.form]}
                  </Chip>
                ))}
              </ChipRow>
            </Section>
          )}

          {/* ── 3. Dose ── */}
          {drug && form && (
            <Section label={t("dosageBuilder.dose")}>
              <ChipRow>
                {(currentVariant?.doses ?? []).map((d) => (
                  <Chip
                    key={d}
                    active={!customDose && dose === d}
                    onClick={() => {
                      setDose(d);
                      setCustomDose(false);
                    }}
                  >
                    {d}
                  </Chip>
                ))}
                <Chip
                  active={customDose}
                  onClick={() => {
                    setCustomDose(true);
                    setDose("");
                  }}
                >
                  {t("dosageBuilder.customDose")}
                </Chip>
              </ChipRow>
              {customDose && (
                <Input
                  autoFocus
                  value={dose}
                  onChange={(e) => setDose(e.target.value)}
                  placeholder={t("dosageBuilder.customDosePlaceholder")}
                  className="mt-2 h-9"
                />
              )}
            </Section>
          )}

          {/* ── 4. Frequency ── */}
          {drug && form && (
            <Section label={t("dosageBuilder.frequency")}>
              <ChipRow>
                {FREQ_ORDER.map((f) => (
                  <Chip
                    key={f}
                    active={frequency === f}
                    onClick={() => setFrequency(f)}
                  >
                    {FREQ_LABELS_RU[f]}
                  </Chip>
                ))}
              </ChipRow>
            </Section>
          )}

          {/* ── 5. Timing ── */}
          {drug && form && (
            <Section label={t("dosageBuilder.timingLabel")}>
              <ChipRow>
                {TIMING_ORDER.map((tm) => (
                  <Chip
                    key={tm}
                    active={timing === tm}
                    onClick={() => setTiming(tm)}
                  >
                    {t(`dosageBuilder.timing.${TIMING_KEY[tm]}`)}
                  </Chip>
                ))}
              </ChipRow>
            </Section>
          )}

          {/* ── 6. Duration ── */}
          {drug && form && (
            <Section label={t("dosageBuilder.duration")}>
              <ChipRow>
                {DURATION_QUICK_PICKS.map((d) => (
                  <Chip
                    key={d}
                    active={duration === d}
                    onClick={() => setDuration(d)}
                  >
                    {d}
                  </Chip>
                ))}
              </ChipRow>
              <Input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder={t("dosageBuilder.durationPlaceholder")}
                className="mt-2 h-9"
              />
            </Section>
          )}

          {/* ── 7. Optional note ── */}
          {drug && form && (
            <Section label={t("dosageBuilder.noteLabel")}>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("dosageBuilder.notePlaceholder")}
                className="h-9"
              />
            </Section>
          )}

          {/* ── Preview ── */}
          {composed && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-primary/70">
                {t("dosageBuilder.preview")}
              </div>
              <div className="mt-1 text-sm font-medium text-foreground">
                {composed}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("actions.cancel")}
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {t("dosageBuilder.addToPrescriptions")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Drug picker ───────────────────────────────────────────────────────

function DrugPicker({
  query,
  onQueryChange,
  drug,
  onPick,
  onClear,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  drug: Drug | null;
  onPick: (d: Drug) => void;
  onClear: () => void;
}) {
  const t = useTranslations("doctor.receptionDialogs");
  const [focused, setFocused] = React.useState(false);
  const hits = React.useMemo(
    () => (focused || query ? searchDrugs(query, 40) : []),
    [focused, query],
  );

  if (drug) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
        <div className="flex items-start gap-3">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <PillIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {drug.nameRu}
            </div>
            <div className="text-xs text-muted-foreground">
              {DRUG_CATEGORY_LABELS_RU[drug.category]}
              {drug.intl ? ` · ${drug.intl}` : ""}
              {drug.brands?.length ? ` · ${drug.brands.join(", ")}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label={t("dosageBuilder.changeDrug")}
            className="inline-flex size-7 items-center justify-center rounded-full text-primary/60 transition-colors hover:bg-primary/10 hover:text-primary"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <Label className="mb-1 block text-xs font-medium text-muted-foreground">
        {t("dosageBuilder.drug")}
      </Label>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("dosageBuilder.drugSearchPlaceholder")}
          className="h-10 pl-9"
          autoFocus
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>
      {focused && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-lg">
          {hits.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(d);
                }}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{d.nameRu}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {DRUG_CATEGORY_LABELS_RU[d.category]}
                    {d.brands?.length ? ` · ${d.brands.join(", ")}` : ""}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tiny primitives ───────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
