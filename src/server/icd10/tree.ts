/**
 * The ICD-10 catalog as a tree to click through: chapter → block → codes.
 *
 * The clinic's request (03.10.2026): the doctor of the visit screen works
 * with the mouse, and the diagnosis must be reachable without typing. The
 * chapter list alone is too coarse for that (chapter G is 331 codes, M is
 * 544), so the visit screen's «Каталог МКБ» column walks the classifier's own
 * blocks («G40-G47 Эпизодические и пароксизмальные расстройства») and only
 * then lists codes, titled by their category («G43 Мигрень»).
 *
 * A node is a chapter or a block, by its range. It answers with its child
 * blocks and the codes that sit in it outside every child block: the book
 * puts some categories straight under a chapter or a parent block (C50 under
 * C00-C97, B99 under A00-B99), and chapter U has no blocks at all. So every
 * code of the catalog is reachable, exactly once (pinned by a test).
 *
 * The headings come from the same dump as the codes (scripts/
 * build-icd10-catalog.mjs writes blocks.json next to data.json). Server only,
 * like the catalog itself: browsers read a node through /api/crm/icd10/tree.
 */
import { ICD10_CHAPTERS } from "@/lib/icd10-chapters";

import tree from "./blocks.json";
import { ICD10_ENTRIES, type Icd10Entry } from "./data";

export type Icd10Block = { range: string; nameRu: string; parent: string };
export type Icd10Heading = { code: string; nameRu: string };

/** One level of the tree, as the column shows it. */
export type Icd10Node = {
  range: string;
  /** Child blocks in code order, each with how many codes it holds. */
  blocks: { range: string; nameRu: string; count: number }[];
  /** Codes in this node outside every child block, in code order. */
  rows: Icd10Entry[];
  /** Names of the categories those codes belong to, for their titles. */
  headings: Icd10Heading[];
};

export type Icd10TreeData = {
  entries: readonly Icd10Entry[];
  blocks: readonly Icd10Block[];
  headings: readonly Icd10Heading[];
  /** Ranges that are chapters (the roots). */
  chapters: readonly string[];
};

export const RANGE_SHAPE = /^[A-Z]\d{2}-[A-Z]\d{2}$/;

/** Whether a code falls in a range, by its three-character category. */
export function inRange(code: string, range: string): boolean {
  const key = code.slice(0, 3).toUpperCase();
  const [lo, hi] = range.split("-") as [string, string];
  return key >= lo && key <= hi;
}

/**
 * The node at `range`, or null for a range that is neither a chapter nor a
 * block of the catalog (the route answers 404 then, never a guess).
 */
export function buildIcd10Node(range: string, data: Icd10TreeData): Icd10Node | null {
  const known =
    data.chapters.includes(range) || data.blocks.some((b) => b.range === range);
  if (!known) return null;

  const children = data.blocks
    .filter((b) => b.parent === range)
    .sort((a, b) => a.range.localeCompare(b.range, "en"));
  const inNode = data.entries.filter((e) => inRange(e.code, range));
  const rows = inNode
    .filter((e) => !children.some((c) => inRange(e.code, c.range)))
    .sort((a, b) => a.code.localeCompare(b.code, "en"));
  const categories = new Set(rows.map((r) => r.code.slice(0, 3)));
  const headings = data.headings
    .filter((h) => categories.has(h.code))
    .sort((a, b) => a.code.localeCompare(b.code, "en"));

  return {
    range,
    blocks: children.map((c) => ({
      range: c.range,
      nameRu: c.nameRu,
      count: inNode.filter((e) => inRange(e.code, c.range)).length,
    })),
    rows,
    headings,
  };
}

let realData: Icd10TreeData | null = null;
const cache = new Map<string, Icd10Node | null>();

/** The catalog's own tree. Nodes are computed once per process: it is static. */
export function icd10Node(range: string): Icd10Node | null {
  const key = range.trim().toUpperCase();
  if (!RANGE_SHAPE.test(key)) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  realData ??= {
    entries: ICD10_ENTRIES,
    blocks: tree.blocks,
    headings: tree.headings,
    chapters: ICD10_CHAPTERS.map((c) => c.id),
  };
  const node = buildIcd10Node(key, realData);
  cache.set(key, node);
  return node;
}
