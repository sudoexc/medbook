/**
 * Converts a full ICD-10 SQL dump into the catalog the picker searches.
 *
 * The bundled list was a hand-curated 465 entries, and the neurologist hit its
 * edges within a week («не все там есть») — chapter G alone had 72 codes when
 * the real chapter has hundreds. This regenerates the catalog from the
 * complete Russian classifier instead of growing the hand-written list.
 *
 * Source dump: https://github.com/lensws/mkb10 (sql/mkb_data.sql), rows shaped
 *   INSERT INTO class_mkb (id, name, code, parent_id, parent_code, node_count, …)
 * where `node_count = 0` marks a leaf — an actual diagnosis rather than a
 * chapter or block heading. Headings are deliberately dropped: «A00-B99
 * Некоторые инфекционные болезни» is not something a doctor writes on a
 * conclusion.
 *
 * Usage:
 *   curl -sL -o /tmp/mkb_data.sql \
 *     https://raw.githubusercontent.com/lensws/mkb10/master/sql/mkb_data.sql
 *   node scripts/build-icd10-catalog.mjs /tmp/mkb_data.sql
 *
 * Writes src/server/icd10/data.ts. Review the diff before committing — this
 * is clinical reference data, not config.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// Payload as JSON, not a TS literal: 10k object literals is 1.2 MB of source
// that Babel refuses to optimise ("exceeds the max of 500KB") and that the
// type-checker walks on every build. JSON.parse is also markedly faster at
// cold start than evaluating the equivalent JS.
const OUT_JSON = join(ROOT, "src", "server", "icd10", "data.json");
const OUT_TS = join(ROOT, "src", "server", "icd10", "data.ts");

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-icd10-catalog.mjs <mkb_data.sql>");
  process.exit(2);
}

const sql = readFileSync(src, "utf8");

// VALUES(id, 'name', 'code', parent_id, parent_code, node_count, …)
const ROW =
  /VALUES\((\d+),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*([^,]+),\s*([^,]+),\s*(\d+),/g;

const unquote = (s) => s.replace(/''/g, "'").replace(/\\n/g, " ").trim();

const seen = new Set();
const entries = [];
let total = 0;
let headings = 0;

for (const m of sql.matchAll(ROW)) {
  total++;
  const [, , rawName, rawCode, , , nodeCount] = m;
  if (nodeCount !== "0") {
    headings++;
    continue; // chapter / block, not a diagnosis
  }
  const code = unquote(rawCode);
  const name = unquote(rawName).replace(/\s+/g, " ");
  if (!code || !name) continue;
  // Ranges like "A00-A09" are headings even when node_count lies.
  if (code.includes("-")) {
    headings++;
    continue;
  }
  if (seen.has(code)) continue;
  seen.add(code);
  entries.push({ code, name });
}

entries.sort((a, b) => a.code.localeCompare(b.code, "en"));

const byChapter = {};
for (const e of entries) {
  const ch = e.code[0];
  byChapter[ch] = (byChapter[ch] ?? 0) + 1;
}

writeFileSync(
  OUT_JSON,
  `${JSON.stringify(
    entries.map((e) => ({ code: e.code, nameRu: e.name })),
    null,
    0,
  )}\n`,
  "utf8",
);

writeFileSync(
  OUT_TS,
  `/**
 * Full ICD-10 catalog (Russian). The payload lives in \`data.json\`; this file
 * only types it. Both are generated — do not hand-edit either.
 *
 * Regenerate with:
 *   curl -sL -o /tmp/mkb_data.sql \\
 *     https://raw.githubusercontent.com/lensws/mkb10/master/sql/mkb_data.sql
 *   node scripts/build-icd10-catalog.mjs /tmp/mkb_data.sql
 *
 * Only leaf codes are included — chapter and block headings ("A00-B99
 * Некоторые инфекционные болезни") are not diagnoses a doctor writes down.
 *
 * ${entries.length} codes across ${Object.keys(byChapter).length} chapters.
 */
import entries from "./data.json";

export type Icd10Entry = {
  code: string;
  nameRu: string;
};

export const ICD10_ENTRIES: Icd10Entry[] = entries;
`,
  "utf8",
);

console.log(`строк в дампе:      ${total}`);
console.log(`разделов отброшено: ${headings}`);
console.log(`кодов записано:     ${entries.length}`);
console.log(
  `по главам:          ${Object.entries(byChapter)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")}`,
);
console.log(`→ ${OUT_JSON}`);
console.log(`→ ${OUT_TS}`);
