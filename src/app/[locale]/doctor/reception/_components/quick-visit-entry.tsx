"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, Loader2Icon } from "lucide-react";

import type { VisitNotePatch, VisitNoteRow } from "../_hooks/use-visit-note";

/**
 * Two fields, right under the patient's name: diagnosis and the one drug that
 * matters. Nothing else.
 *
 * The doctor's verdict on the full editor was that a 15-minute visit does not
 * survive walking through separate panels — he wanted to "быстро набросать"
 * the diagnosis in his own words plus the single medication the patient is
 * actually on. The structured panels below stay exactly as they are for the
 * visits that deserve them; this is the fast lane, not a replacement.
 *
 * Both fields write straight into the same VisitNote the panels edit, so
 * anything typed here shows up in the conclusion and the patient's handout.
 * Saving is on blur and on Enter — never on every keystroke, because each
 * PATCH bumps the note version and would fight the panels for it.
 */
export function QuickVisitEntry({
  note,
  disabled,
  saving,
  onChange,
}: {
  note: VisitNoteRow;
  disabled: boolean;
  saving: boolean;
  onChange: (patch: VisitNotePatch) => void;
}) {
  const t = useTranslations("doctor.reception.quickEntry");

  // The diagnosis field shows the name; a code picked from ICD-10 is shown
  // next to it as a chip rather than crammed into the input.
  const [dx, setDx] = React.useState(note.diagnosisName ?? "");
  const [drug, setDrug] = React.useState("");
  const [justSaved, setJustSaved] = React.useState<"dx" | "drug" | null>(null);

  React.useEffect(() => {
    setDx(note.diagnosisName ?? "");
  }, [note.diagnosisName]);

  const flash = (which: "dx" | "drug") => {
    setJustSaved(which);
    setTimeout(() => setJustSaved((v) => (v === which ? null : v)), 1500);
  };

  const commitDx = () => {
    const v = dx.trim();
    if (v === (note.diagnosisName ?? "").trim()) return;
    // Typing over a code-picked diagnosis drops the code: the text no longer
    // corresponds to it, and a stale code is worse than none.
    onChange({ diagnosisName: v || null, diagnosisCode: null });
    flash("dx");
  };

  const commitDrug = () => {
    const v = drug.trim();
    if (!v) return;
    const existing = note.prescriptions ?? [];
    if (existing.includes(v)) {
      setDrug("");
      return;
    }
    onChange({ prescriptions: [...existing, v] });
    setDrug("");
    flash("drug");
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, commit: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      e.currentTarget.blur();
    }
  };

  const field =
    "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

  const meds = note.prescriptions ?? [];

  return (
    <div className="border-t border-border bg-muted/20 px-5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1">
          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            {t("diagnosisLabel")}
            {note.diagnosisCode && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                {note.diagnosisCode}
              </span>
            )}
            {justSaved === "dx" && (
              <CheckIcon className="size-3 text-success" aria-hidden />
            )}
          </label>
          <input
            type="text"
            disabled={disabled}
            value={dx}
            maxLength={300}
            placeholder={t("diagnosisPlaceholder")}
            onChange={(e) => setDx(e.target.value)}
            onBlur={commitDx}
            onKeyDown={(e) => onKey(e, commitDx)}
            className={field}
          />
        </div>

        <div className="min-w-0 flex-1">
          <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            {t("drugLabel")}
            {justSaved === "drug" && (
              <CheckIcon className="size-3 text-success" aria-hidden />
            )}
            {saving && <Loader2Icon className="size-3 animate-spin" aria-hidden />}
          </label>
          <input
            type="text"
            disabled={disabled}
            value={drug}
            maxLength={300}
            placeholder={t("drugPlaceholder")}
            onChange={(e) => setDrug(e.target.value)}
            onBlur={commitDrug}
            onKeyDown={(e) => onKey(e, commitDrug)}
            className={field}
          />
        </div>
      </div>

      {meds.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {meds.map((m, i) => (
            <li
              key={`${m}-${i}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5 text-xs text-foreground"
            >
              <span className="truncate">{m}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={t("removeDrug")}
                  onClick={() =>
                    onChange({ prescriptions: meds.filter((_, j) => j !== i) })
                  }
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{t("hint")}</p>
      )}
    </div>
  );
}
