/**
 * «Мои частые» — what a doctor sees on tapping the diagnosis or drug field
 * before typing anything.
 *
 * The clinic's request (25.09.2026): every doctor has his own handful of
 * diagnoses and drugs he writes again and again (one lives on migraine and
 * tension headache, another on lumbago); those must be one tap away, and
 * everything else stays out of sight until he searches for it.
 *
 * Pure functions: the routes feed them rows, the tests feed them arrays.
 *
 * Ranking, both lists:
 *   1. what the doctor starred, in his own order;
 *   2. what he actually wrote, most often first, ties to the most recent.
 * Counted over drafts too: in this clinic most visits are never signed, and
 * a list built from signed notes alone would be empty for the busiest doctor.
 */
import { normalizeCatalogTerm } from "@/server/catalog/formulary";

/**
 * However many stars a doctor has, this much of his real history still
 * shows: a long favourites list must not hide what he writes every day.
 */
const MIN_HISTORY = 5;

function withHistory<T>(pinned: T[], rest: T[], limit: number): T[] {
  return [
    ...pinned,
    ...rest.slice(0, Math.max(limit - pinned.length, MIN_HISTORY)),
  ];
}

// ───────────────────────── Diagnoses ─────────────────────────

export type DiagnosisUse = {
  code: string | null;
  name: string | null;
  at: Date;
};

export type DiagnosisShortItem = {
  code: string | null;
  name: string;
  count: number;
  pinned: boolean;
};

/** ICD codes group case-insensitively; free text groups by wording. */
function diagnosisKey(code: string | null, name: string): string {
  const c = code?.trim().toUpperCase();
  return c ? `code:${c}` : `text:${normalizeCatalogTerm(name)}`;
}

export function buildDiagnosisShortlist(args: {
  /** Starred ICD codes, in the doctor's order. */
  pinnedCodes: string[];
  uses: DiagnosisUse[];
  /** Wording for a starred code he never used yet. */
  nameForCode: (code: string) => string | null;
  limit: number;
}): DiagnosisShortItem[] {
  type Acc = DiagnosisShortItem & { lastAt: number };
  const acc = new Map<string, Acc>();

  // Newest first, so the first wording seen for a code is the current one.
  const uses = [...args.uses].sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const u of uses) {
    const name = u.name?.trim();
    if (!name) continue;
    const code = u.code?.trim() || null;
    const key = diagnosisKey(code, name);
    const cur = acc.get(key);
    if (cur) {
      cur.count += 1;
      continue;
    }
    acc.set(key, {
      code: code ? code.toUpperCase() : null,
      name,
      count: 1,
      pinned: false,
      lastAt: u.at.getTime(),
    });
  }

  const pinned: DiagnosisShortItem[] = [];
  for (const raw of args.pinnedCodes) {
    const code = raw.trim().toUpperCase();
    if (!code) continue;
    const key = `code:${code}`;
    const used = acc.get(key);
    if (used) {
      acc.delete(key);
      pinned.push({ code, name: used.name, count: used.count, pinned: true });
      continue;
    }
    const name = args.nameForCode(code);
    if (name) pinned.push({ code, name, count: 0, pinned: true });
  }

  const rest = [...acc.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map((a) => ({ code: a.code, name: a.name, count: a.count, pinned: a.pinned }));

  return withHistory(pinned, rest, args.limit);
}

// ───────────────────────── Drugs ─────────────────────────

export type StructuredDrugUse = {
  drugId: string | null;
  displayName: string;
  dose: string | null;
  at: Date;
};

export type DrugShortItem = {
  /** drugId for catalog rows, `text:<label>` for free-typed ones. */
  key: string;
  drugId: string | null;
  label: string;
  count: number;
  lastDose: string | null;
  pinned: boolean;
};

export function buildDrugShortlist(args: {
  /** Starred drug ids, in the doctor's order. */
  pinnedIds: string[];
  structured: StructuredDrugUse[];
  /** Free-text quick-entry lines (VisitNote.prescriptions). */
  freeText: { line: string; at: Date }[];
  limit: number;
}): DrugShortItem[] {
  type Acc = DrugShortItem & { lastAt: number };
  const acc = new Map<string, Acc>();

  const bump = (
    key: string,
    drugId: string | null,
    label: string,
    dose: string | null,
    at: Date,
  ) => {
    const cur = acc.get(key);
    if (cur) {
      cur.count += 1;
      if (at.getTime() > cur.lastAt) {
        // The newest spelling and dose win.
        cur.lastAt = at.getTime();
        cur.label = label;
        cur.lastDose = dose ?? cur.lastDose;
      } else if (!cur.lastDose && dose) {
        cur.lastDose = dose;
      }
      return;
    }
    acc.set(key, {
      key,
      drugId,
      label,
      count: 1,
      lastDose: dose,
      pinned: false,
      lastAt: at.getTime(),
    });
  };

  for (const s of args.structured) {
    const label = s.displayName.trim();
    if (label.length < 2) continue;
    const key = s.drugId ?? `text:${normalizeCatalogTerm(label)}`;
    bump(key, s.drugId, label, s.dose?.trim() || null, s.at);
  }
  for (const f of args.freeText) {
    const label = f.line.trim();
    if (label.length < 2) continue;
    bump(`text:${normalizeCatalogTerm(label)}`, null, label, null, f.at);
  }

  const pinned: DrugShortItem[] = [];
  for (const id of args.pinnedIds) {
    const used = acc.get(id);
    if (used) {
      acc.delete(id);
      pinned.push({ ...toDrugItem(used), pinned: true });
    } else {
      // Label filled from the catalog row by the route.
      pinned.push({
        key: id,
        drugId: id,
        label: "",
        count: 0,
        lastDose: null,
        pinned: true,
      });
    }
  }

  const rest = [...acc.values()]
    .sort((a, b) => b.count - a.count || b.lastAt - a.lastAt)
    .map(toDrugItem);

  return withHistory(pinned, rest, args.limit);
}

function toDrugItem(a: DrugShortItem): DrugShortItem {
  return {
    key: a.key,
    drugId: a.drugId,
    label: a.label,
    count: a.count,
    lastDose: a.lastDose,
    pinned: a.pinned,
  };
}
