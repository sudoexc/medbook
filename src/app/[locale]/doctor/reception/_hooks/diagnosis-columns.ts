/**
 * What the diagnosis picker's three columns show (clinic request
 * 03.10.2026: the diagnosis picked with the mouse, no typing), and what
 * «Обычно при <диагноз>» still has to add.
 *
 *   «Частые»      — what this doctor writes most (the server's `frequent`);
 *   «Мои»         — his starred codes, in his order (`starredDiagnosisColumn`);
 *   «Каталог МКБ» — chapter → block → codes, the codes titled by their
 *                   category (`groupNodeRows`).
 *
 * Pure: the picker and the memory card render these, the tests drive them.
 */
import {
  formatPrescriptionHead,
  formatPrescriptionSchedule,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";
import { visitDiagnosisKey } from "@/lib/visit-diagnoses";

import { onVisitChecker } from "./prescription-columns";
import { draftFromShortItem, splitFreeLine } from "./prescription-rows";
import type { DiagnosisMemory, DiagnosisShortItem, DrugShortItem } from "./use-shortlists";

/**
 * «Мои»: his stars in his order, each with its words.
 *
 * `favorites` is the starred list as the favourites hook holds it, which a
 * click updates at once; null while it loads, and then the server's
 * `starred` list stands in. A code starred a moment ago is not in the list
 * the server sent: its words come from the row he starred it on (`seen`),
 * or from any other list of the same answer (`known`). A star nobody can
 * name yet waits for the next answer.
 */
export function starredDiagnosisColumn(args: {
  favorites: readonly string[] | null;
  starred: readonly DiagnosisShortItem[];
  known: readonly DiagnosisShortItem[];
  seen: ReadonlyMap<string, string>;
}): DiagnosisShortItem[] {
  if (args.favorites === null) {
    return args.starred.map((d) => ({ ...d, pinned: true }));
  }
  const byCode = new Map<string, DiagnosisShortItem>();
  for (const d of [...args.known, ...args.starred]) {
    if (d.code) byCode.set(d.code.toUpperCase(), d);
  }
  const out: DiagnosisShortItem[] = [];
  const done = new Set<string>();
  for (const raw of args.favorites) {
    const code = raw.trim().toUpperCase();
    if (!code || done.has(code)) continue;
    done.add(code);
    const item = byCode.get(code);
    if (item) {
      out.push({ ...item, code, pinned: true });
      continue;
    }
    const name = args.seen.get(code);
    if (name) out.push({ code, name, count: 0, pinned: true });
  }
  return out;
}

/** Whether a diagnosis is on the visit: same code, or the same words. */
export function diagnosisOnVisitChecker(
  list: readonly { code: string | null; name: string | null }[],
): (d: { code?: string | null; name?: string | null }) => boolean {
  const keys = new Set(
    list.map((d) => visitDiagnosisKey(d)).filter((k): k is string => k !== null),
  );
  return (d) => {
    const key = visitDiagnosisKey(d);
    return key !== null && keys.has(key);
  };
}

export type NodeRow = { code: string; nameRu: string };
export type NodeGroup = {
  /** The category the codes belong to; null for codes that are categories. */
  heading: NodeRow | null;
  rows: NodeRow[];
};

/**
 * A block's codes under their category's title («G43 Мигрень»: G43.0 …
 * G43.9), in code order. A category that is a code itself (G20) has no
 * subcategories to title: such codes run together under no heading, so a
 * block of them reads as one plain list.
 */
export function groupNodeRows(
  rows: readonly NodeRow[],
  headings: readonly NodeRow[],
): NodeGroup[] {
  const titles = new Map(headings.map((h) => [h.code.toUpperCase(), h]));
  const groups: NodeGroup[] = [];
  for (const row of rows) {
    const category = row.code.slice(0, 3).toUpperCase();
    const heading = row.code.length > 3 ? (titles.get(category) ?? null) : null;
    const last = groups.at(-1);
    if (last && (last.heading?.code ?? null) === (heading?.code ?? null)) {
      last.rows.push(row);
    } else {
      groups.push({ heading, rows: [row] });
    }
  }
  return groups;
}

/** Recommendations compare by their words: case, spacing and ё aside. */
export function adviceKey(line: string): string {
  return line.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Whether a recommendation is on the visit already. */
export function adviceChecker(lines: readonly string[]): (line: string) => boolean {
  const keys = new Set(lines.map(adviceKey).filter(Boolean));
  return (line) => keys.has(adviceKey(line));
}

/**
 * What «Добавить всё» adds: every usual prescription and recommendation of
 * the memory that the visit does not hold yet, in the memory's order.
 *
 * Each drug once (review of 03.10.2026): the memory may still hold one drug
 * twice (a catalog row and the line «Мексидол 5,0 в/м №10» from a preset),
 * and both used to land, one as a row and one as a line. Within the batch
 * an item is skipped when one already taken is the same drug, by the rule
 * that marks it on the visit. Catalog drugs are taken first, so the one
 * that stays is the row with his dose and schema, not the bare line.
 */
export function memoryToAdd(
  memory: Pick<DiagnosisMemory, "prescriptions" | "advice">,
  rxOnVisit: (item: { drugId: string | null; label: string }) => boolean,
  adviceOnVisit: (line: string) => boolean,
): { items: DrugShortItem[]; lines: string[] } {
  const fresh = memory.prescriptions.filter((p) => !rxOnVisit(p));
  const taken: DrugShortItem[] = [];
  const byKind = [...fresh].sort((a, b) => Number(!!b.drugId) - Number(!!a.drugId));
  for (const item of byKind) {
    const sameDrug = onVisitChecker(
      taken.map((t) => ({ drugId: t.drugId, displayName: splitFreeLine(t.label).name })),
      taken.filter((t) => !t.drugId).map((t) => t.label),
    );
    if (!sameDrug(item)) taken.push(item);
  }
  const kept = new Set(taken);
  return {
    items: fresh.filter((p) => kept.has(p)),
    lines: memory.advice.map((a) => a.line).filter((l) => !adviceOnVisit(l)),
  };
}

/**
 * A usual prescription as its chip reads: the drug, then its dose and
 * schema, taken from the very row a click adds, so the chip never promises
 * another dose than the one that lands. Two parts, not one line: the chip
 * sets them apart by weight instead of a dash.
 */
export function memoryChipText(
  item: DrugShortItem,
  locale: PrescriptionLocale,
): { head: string; schedule: string } {
  const { draft } = draftFromShortItem(item, "mine");
  return {
    head: formatPrescriptionHead(draft),
    schedule: formatPrescriptionSchedule(draft, locale),
  };
}
