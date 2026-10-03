/**
 * Converts a full ICD-10 SQL dump into the catalog the picker searches.
 *
 * The bundled list was a hand-curated 465 entries, and the neurologist hit its
 * edges within a week («не все там есть») — chapter G alone had 72 codes when
 * the real chapter has hundreds. This regenerates the catalog from the
 * complete Russian classifier instead of growing the hand-written list.
 *
 * Source dump: https://github.com/lensws/mkb10 (sql/mkb_data.sql), rows shaped
 *   INSERT INTO class_mkb (id, name, code, parent_id, parent_code, node_count, additional_info)
 * where `node_count = 0` marks a leaf — an actual diagnosis rather than a
 * chapter or block heading. Headings are deliberately dropped: «A00-B99
 * Некоторые инфекционные болезни» is not something a doctor writes on a
 * conclusion.
 *
 * Leaf names are NOT always diagnoses on their own (audit CT-06). In the
 * printed classifier a subcategory is often only the rest of its category's
 * sentence: under «D33 Доброкачественное новообразование головного мозга…»
 * the leaf D33.0 reads «Головного мозга над мозговым наметом», and D43.0
 * (uncertain behaviour) reads exactly the same. Copied as is, a signed
 * conclusion said «D33.0 Головного мозга над мозговым наметом», without the
 * word «новообразование», and 216 names were shared by two or more codes.
 * So a leaf that only makes sense with its parent gets the parent's words
 * (see `composeName`), and the build fails if two codes still share a name.
 *
 * The dump also carries the printed book's line breaks: a name cut at a
 * hyphen («вышеука-») continues in `additional_info`, and a few words were
 * split by a stray space («одновре менным»). Both are repaired from the
 * source itself, never guessed (see `repairName`).
 *
 * Usage:
 *   curl -sL -o /tmp/mkb_data.sql \
 *     https://raw.githubusercontent.com/lensws/mkb10/master/sql/mkb_data.sql
 *   node scripts/build-icd10-catalog.mjs /tmp/mkb_data.sql
 *
 * Writes src/server/icd10/data.json and data.ts, and blocks.json: the
 * chapter and category headings kept apart for browsing (see «The tree, for
 * browsing» below). Review the diff before committing — this is clinical
 * reference data, not config.
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

// VALUES(id, 'name', 'code', parent_id, parent_code, node_count, 'info' | NULL)
const ROW =
  /VALUES\((\d+),\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*([^,]+),\s*([^,]+),\s*(\d+),\s*(NULL|'((?:[^']|'')*)')\)/g;

const unquote = (s) => s.replace(/''/g, "'").replace(/\\n/g, " ").trim();

/** A real ICD code: «G43», «G43.0», «A52.0+», «D63.8*». */
const CODE_SHAPE = /^[A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?[+*]?$/;

// ───────────────────────── Name repair ─────────────────────────

/**
 * Words the printed book split with a space at a line break. Listed one by
 * one: a generic «join two short words» rule would also glue correct text
 * such as «по ведению» or «(поли)миозит».
 */
const SPLIT_WORDS = [
  ["ново образования", "новообразования"],
  ["внутри брюшных", "внутрибрюшных"],
  ["иммуно глобулинов", "иммуноглобулинов"],
  ["недо статочностью", "недостаточностью"],
  ["классифициро ванных", "классифицированных"],
  ["классифици рованных", "классифицированных"],
  ["класси фицированных", "классифицированных"],
  ["классифи цированные", "классифицированные"],
  ["новообразо ваниях", "новообразованиях"],
  ["гипер тензия", "гипертензия"],
  ["микро организмами", "микроорганизмами"],
  ["бактери альными", "бактериальными"],
  ["тазобед ренного", "тазобедренного"],
  ["тазо бедренного", "тазобедренного"],
  ["неуточ ненном", "неуточненном"],
  ["неуточнен ными", "неуточненными"],
  ["конеч ности", "конечности"],
  ["противовоспали тельными", "противовоспалительными"],
  ["используе мого", "используемого"],
  ["транс портных", "транспортных"],
  ["терапевти ческой", "терапевтической"],
  ["терапев тических", "терапевтических"],
  ["установ ленного", "установленного"],
  ["злокачествен ного", "злокачественного"],
  ["пси хологического", "психологического"],
  ["обсто ятельствами", "обстоятельствами"],
  ["анти коагулянтов", "антикоагулянтов"],
  ["одновре менным", "одновременным"],
  // Typos of the dump, not of the classifier.
  ["пострадавше в ", "пострадавшее в "],
  ["чувчтвительного", "чувствительного"],
  ["прдукты", "продукты"],
  ["Веосипедист", "Велосипедист"],
];

/**
 * Where the dump itself is wrong and the fix cannot be read from it: the
 * classifier's own wording (МКБ-10, том 1).
 *   B39.4 lost «вызванный Histoplasma capsulatum» and reads like B39.9.
 *   I13.1 lost «сердца и» and reads like I12.0, a different category.
 *   M22.3 and M22.8 share one Russian wording; M22.8 is the category's
 *     «other specified» slot, named the way the classifier names that slot.
 */
const OVERRIDES = {
  "B39.4": "Гистоплазмоз, вызванный Histoplasma capsulatum, неуточненный",
  "I13.1":
    "Гипертензивная [гипертоническая] болезнь с преимущественным поражением сердца и почек с почечной недостаточностью",
  "M22.8": "Другие уточненные поражения надколенника",
};

/**
 * Rows whose note starts in lower case but is an inclusion term, not the
 * rest of the name («слабо выраженная умственная субнормальность»).
 */
const NOT_CONTINUED = new Set(["F70.9", "Q15.9"]);

/**
 * The part of `additional_info` that finishes a name cut by the book's line
 * break: its first line, up to the first bracket or capitalised word (the
 * inclusion terms and page references that follow it).
 */
function continuation(info) {
  if (!info) return null;
  const line = info.split("\\n")[0].replace(/''/g, "'").trim();
  if (!/^[a-zа-яё]/.test(line)) return null;
  const words = [];
  for (const w of line.split(/\s+/)) {
    if (w.startsWith("[") || /^[A-ZА-ЯЁ]/.test(w)) break;
    words.push(w);
  }
  return words.length > 0 ? words.join(" ") : null;
}

const repaired = [];

function repairName(code, rawName, info) {
  let name = unquote(rawName).replace(/\s+/g, " ");
  if (OVERRIDES[code]) return OVERRIDES[code];
  const rest = NOT_CONTINUED.has(code) ? null : continuation(info);
  if (rest) {
    // «вышеука-» + «занных» joins without a space; «пределы» + «одной» with.
    name = /\p{L}-$/u.test(name) ? `${name.slice(0, -1)}${rest}` : `${name} ${rest}`;
    repaired.push(`${code}: …${name.slice(-60)}`);
  }
  for (const [bad, good] of SPLIT_WORDS) name = name.split(bad).join(good);
  // «ДРУГИЕ ИНФЕКЦИОННЫЕ БОЛЕЗНИ»: a heading typed in capitals.
  if (!/[а-яё]/.test(name) && /[А-ЯЁ]{4}/.test(name)) {
    name = name[0] + name.slice(1).toLowerCase();
  }
  return name;
}

// ───────────────────────── Parent context ─────────────────────────

/**
 * Lower-case the first letter when it opens a normal word («Мозжечка» →
 * «мозжечка», «В съеденных» → «в съеденных»); «ВИЧ» and «B-клеточная» stay.
 */
function lcFirst(s) {
  return s.replace(/^([^\p{L}]*)(\p{Lu})(?=\p{Ll}|\s)/u, (_, pre, ch) => pre + ch.toLowerCase());
}

/**
 * Chapter II (C00–D48). A category reads «<head> <site>» and its leaves name
 * a narrower site in the genitive: «Злокачественное новообразование» +
 * «мозжечка». The head is what the leaf lacks; the parent's own site is
 * replaced by the leaf's. Longest first, so «Новообразование неопределенного
 * или неизвестного характера» wins over a shorter prefix.
 */
const NEOPLASM_HEADS = [
  "Вторичное и неуточненное злокачественное новообразование",
  "Вторичное злокачественное новообразование",
  "Другие злокачественные новообразования",
  "Злокачественное новообразование",
  "Карцинома in situ",
  "Другие доброкачественные новообразования",
  "Доброкачественные новообразования",
  "Доброкачественное новообразование",
  "Другие новообразования неопределенного или неизвестного характера",
  "Новообразования неопределенного или неизвестного характера",
  "Новообразование неопределенного или неизвестного характера",
];

/** A plural category head, used with one site: the classifier's singular. */
const SINGULAR_HEAD = {
  "Доброкачественные новообразования": "Доброкачественное новообразование",
  "Новообразования неопределенного или неизвестного характера":
    "Новообразование неопределенного или неизвестного характера",
};

/** A leaf that names the tumour itself stands on its own («Гепатобластома»). */
const NAMES_TUMOUR =
  /новообразован|(^|\s)рак|карцином|меланом|сарком|лимфом|лейкоз|лейкем|миелом|бластом|ангиом|аденом|фибром|липом|невус|мезотелиом|ходжкин|болезн|синдром|гистиоцитоз|мастоцитоз|микоз|макроглобулин|полицитем|тромбоцитем|анеми|миелофиброз|панмиелоз|гаммапат|цитопени|плазмоцитом|опухол|ретикулез|тератом|эритрем|ом[аы](\s|,|$)|in situ|капоши/i;

/**
 * A leaf that qualifies its category rather than naming a narrower site
 * («Поражение, выходящее за пределы…»): the whole category, then the leaf.
 */
const NEOPLASM_QUALIFIER = /^(поражени|неточно обозначенные|множественн)/i;

const PREPOSITION = /^(в|во|на|при|с|со|без|у|от|для|из|к|по|над|под)\s/i;

function isNeoplasm(code) {
  return /^(C\d|D[0-4]\d)/.test(code);
}

function headOf(parentName, heads) {
  const lower = parentName.toLowerCase();
  return heads.find((h) => lower.startsWith(h.toLowerCase())) ?? null;
}

/**
 * The leaf's name as a diagnosis, or null when its own name already is one.
 *
 *   - Chapter II sites: head + site («Доброкачественное новообразование
 *     головного мозга над мозговым наметом»).
 *   - T36–T50 poisonings and T51–T65 toxic effects: the leaf is the agent in
 *     the case the head governs («Отравление иминостильбенами»,
 *     «Токсическое действие этанола»).
 *   - Y06/Y07: the leaf is the perpetrator («…родителем»), read after the
 *     whole category.
 *   - Everything else keeps its name here; `withContext` handles the leaves
 *     that still collide.
 */
function composeName(code, name, parentName) {
  if (isNeoplasm(code)) {
    if (NAMES_TUMOUR.test(name)) return null;
    const head = headOf(parentName, NEOPLASM_HEADS);
    if (!head || NEOPLASM_QUALIFIER.test(name)) return withContext(name, parentName);
    return `${SINGULAR_HEAD[head] ?? head} ${lcFirst(name)}`;
  }
  const cat = code.slice(0, 3);
  if (cat >= "T36" && cat <= "T50" && /^Отравление\s/.test(parentName)) {
    if (/^отравлени/i.test(name)) return null;
    return `Отравление ${lcFirst(name)}`;
  }
  if (cat >= "T51" && cat <= "T65") {
    if (/^(отравлени|токсическ)/i.test(name)) return null;
    const head = headOf(parentName, ["Токсическое действие", "Токсический эффект"]);
    if (!head) return null;
    if (PREPOSITION.test(name)) return withContext(name, parentName);
    return `${head} ${lcFirst(name)}`;
  }
  if (cat === "Y06" || cat === "Y07") return `${parentName} ${lcFirst(name)}`;
  return null;
}

/** The category, then the leaf: «Язва желудка: острая с кровотечением». */
function withContext(name, parentName) {
  return `${parentName}: ${lcFirst(name)}`;
}

// ───────────────────────── Shared fourth characters ─────────────────────────

/**
 * Categories whose subcategories the book lists once, in the block's note
 * (audit CT-02). Under «E10-E14 САХАРНЫЙ ДИАБЕТ» it reads «Следующие
 * четвертые знаки используются с рубриками E10-E14: .0 С комой … .9 Без
 * осложнений», and E10…E14 themselves are rows without children. Taken as
 * leaves, the catalog offered E11 and no E11.4, so a diabetic polyneuropathy
 * (E11.4 with G63.2*, as G63.2* itself says) went into a conclusion as a
 * bare E11. Each such category is expanded into the subcategories the note
 * names, worded from the note itself, and becomes a heading like every
 * other category with subcategories.
 *
 * Only where the block's categories have no rows of their own: V90-V94
 * carries the same note over categories the dump already subdivides.
 *
 * The book marks .2 to .4 with a dagger: that is the pairing convention with
 * the asterisk codes naming the complication (G63.2*), written on the line
 * of the note. The code the clinic writes is E11.4.
 */
const SHARED_FOURTH = /Следующие четвертые знаки используются с рубриками ([A-Z]\d{2})-([A-Z]\d{2}):/;

function sharedFourthCharacters(info) {
  if (!info) return null;
  const head = info.match(SHARED_FOURTH);
  if (!head) return null;
  const subs = [];
  for (const raw of info.slice(head.index + head[0].length).split("\\n")) {
    const m = raw.replace(/''/g, "'").trim().match(/^\.(\d)\+?\s+(.+)$/);
    if (!m) continue;
    // «С комой Диабетическая: . кома …»: the title, then its inclusion
    // terms, which start at the next capitalised word.
    const [first, ...rest] = m[2].split(/\s+/);
    const title = [first];
    for (const w of rest) {
      if (!/^[а-яё]/.test(w)) break;
      title.push(w);
    }
    subs.push({ digit: m[1], title: title.join(" ") });
  }
  return { from: head[1], to: head[2], subs };
}

/**
 * Chapter XXII, «Коды для особых целей»: the dump predates it, and a patient
 * after COVID-19 (U09.9) could not be coded at all. The WHO ICD-10 codes for
 * COVID-19, worded as the Russian Ministry of Health's letters on coding
 * COVID-19 word them. Nothing else of the chapter is in clinical use here.
 */
const SUPPLEMENT = [
  { code: "U07.1", name: "COVID-19, вирус идентифицирован" },
  { code: "U07.2", name: "COVID-19, вирус не идентифицирован" },
  { code: "U08.9", name: "Личный анамнез COVID-19, неуточненный" },
  { code: "U09.9", name: "Состояние после COVID-19, неуточненное" },
  {
    code: "U10.9",
    name: "Мультисистемный воспалительный синдром, связанный с COVID-19, неуточненный",
  },
  { code: "U11.9", name: "Необходимость иммунизации против COVID-19, неуточненная" },
  {
    code: "U12.9",
    name: "Вакцины против COVID-19, вызвавшие неблагоприятные реакции при терапевтическом применении, неуточненные",
  },
];

// ───────────────────────── Build ─────────────────────────

const rows = [];
let total = 0;
for (const m of sql.matchAll(ROW)) {
  total++;
  const [, id, rawName, rawCode, parentId, , nodeCount, , info] = m;
  const code = unquote(rawCode);
  rows.push({
    id: Number(id),
    code,
    parentId: /^\d+$/.test(parentId.trim()) ? Number(parentId.trim()) : null,
    leaf: nodeCount === "0",
    name: repairName(code, rawName, info ?? null),
    info: info ?? null,
  });
}
const byId = new Map(rows.map((r) => [r.id, r]));

// Category row id → the subcategories its block's note gives it.
const expanded = new Map();
for (const block of rows) {
  if (!block.code.includes("-")) continue;
  const shared = sharedFourthCharacters(block.info);
  if (!shared) continue;
  const cats = rows.filter(
    (r) =>
      r.parentId === block.id &&
      /^[A-Z]\d{2}$/.test(r.code) &&
      r.code >= shared.from &&
      r.code <= shared.to,
  );
  if (cats.length === 0 || cats.some((c) => !c.leaf)) continue;
  const digits = shared.subs.map((s) => s.digit).join("");
  if (digits !== "0123456789") {
    console.error(`${block.code}: the note lists fourth characters «${digits}», not .0 to .9`);
    process.exit(1);
  }
  for (const c of cats) {
    // «Сахарный диабет, связанный с недостаточностью питания, с комой»:
    // a category worded with a comma takes one before the subcategory too.
    const sep = c.name.includes(",") ? ", " : " ";
    expanded.set(
      c.id,
      shared.subs.map((s) => ({
        code: `${c.code}.${s.digit}`,
        name: `${c.name}${sep}${lcFirst(s.title)}`,
      })),
    );
  }
}

/**
 * The category a leaf belongs to, or null under a block («A00-A09»): a
 * block heading is a chapter subdivision, not part of the diagnosis.
 */
function categoryOf(r) {
  const p = r.parentId != null ? byId.get(r.parentId) : null;
  if (!p || p.code.includes("-")) return null;
  return p;
}

const seen = new Set();
const entries = [];
let headings = 0;
let junk = 0;
let composed = 0;

for (const r of rows) {
  if (!r.leaf || r.code.includes("-")) {
    headings++;
    continue; // chapter / block, not a diagnosis
  }
  if (!r.code || !r.name) continue;
  // «K91.4,» / «N99.5)»: a cross-reference the dump split into a row.
  if (!CODE_SHAPE.test(r.code)) {
    junk++;
    continue;
  }
  if (seen.has(r.code)) continue;
  seen.add(r.code);
  const subs = expanded.get(r.id);
  if (subs) {
    // E11 is a heading now; its subcategories are the diagnoses.
    headings++;
    for (const s of subs) {
      seen.add(s.code);
      entries.push({ code: s.code, name: s.name, own: s.name, parent: r });
    }
    continue;
  }
  const parent = categoryOf(r);
  const full = parent ? composeName(r.code, r.name, parent.name) : null;
  if (full) composed++;
  entries.push({ code: r.code, name: full ?? r.name, own: r.name, parent });
}
for (const s of SUPPLEMENT) {
  if (seen.has(s.code)) {
    console.error(`${s.code} is in the dump now: drop it from SUPPLEMENT`);
    process.exit(1);
  }
  seen.add(s.code);
  entries.push({ code: s.code, name: s.name, own: s.name, parent: null });
}
// Every code the catalog ships has the classifier's shape (audit CT-02).
const misshapen = entries.filter((e) => !CODE_SHAPE.test(e.code));
if (misshapen.length > 0) {
  console.error(`Codes of a wrong shape: ${misshapen.map((e) => e.code).join(", ")}`);
  process.exit(1);
}

// Leaves that still share a name («Острая интоксикация» under every F1x):
// the category tells them apart.
const norm = (s) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const countNames = () => {
  const c = new Map();
  for (const e of entries) c.set(norm(e.name), (c.get(norm(e.name)) ?? 0) + 1);
  return c;
};
let counts = countNames();
for (const e of entries) {
  if ((counts.get(norm(e.name)) ?? 0) > 1 && e.parent && e.name === e.own) {
    e.name = withContext(e.own, e.parent.name);
    composed++;
  }
}
counts = countNames();
const clashes = entries.filter((e) => (counts.get(norm(e.name)) ?? 0) > 1);
if (clashes.length > 0) {
  console.error("Codes still sharing a name:");
  for (const e of clashes) console.error(`  ${e.code} ${e.name}`);
  process.exit(1);
}
const dashed = entries.filter((e) => /[—–]/.test(e.name));
if (dashed.length > 0) {
  console.error(`Names with a dash: ${dashed.map((e) => e.code).join(", ")}`);
  process.exit(1);
}

entries.sort((a, b) => a.code.localeCompare(b.code, "en"));

// ───────────────────────── The tree, for browsing ─────────────────────────

/**
 * The headings dropped above, kept apart for the visit screen's «Каталог МКБ»
 * column (clinic request 03.10.2026: the doctor picks a diagnosis with the
 * mouse, chapter → block → code, without typing). Nothing here is ever
 * written into a conclusion; it only names the levels he clicks through.
 *
 *   - blocks: «G40-G47 Эпизодические и пароксизмальные расстройства», each
 *     with its parent (a chapter, or a block: C00-C97 holds C00-C14 …);
 *   - headings: the categories that have subcategories («G43 Мигрень»), to
 *     title their codes in a block's list. A category that is itself a code
 *     (G20) is in data.json already.
 */
const OUT_BLOCKS = join(ROOT, "src", "server", "icd10", "blocks.json");
const RANGE_SHAPE = /^[A-Z]\d{2}-[A-Z]\d{2}$/;

/**
 * A heading as the column shows it. `repairName` has already sentence-cased
 * the ones typed in capitals; what that lowercased too much, a typo of the
 * book and a range printed into one heading are put right here.
 */
const HEADING_FIXES = [
  ["железыи ", "железы и "],
  ["[вич]", "[ВИЧ]"],
  [/\s+[a-z]\d{2}-[a-z]\d{2}$/i, ""],
];

function headingName(name) {
  let out = name;
  for (const [bad, good] of HEADING_FIXES) out = out.replace(bad, good);
  return out.trim();
}

const blocks = [];
for (const r of rows) {
  if (!RANGE_SHAPE.test(r.code) || r.parentId == null) continue;
  const parent = byId.get(r.parentId);
  if (!parent || !RANGE_SHAPE.test(parent.code)) continue;
  blocks.push({ range: r.code, nameRu: headingName(r.name), parent: parent.code });
}
const categoryHeadings = [];
const headingSeen = new Set();
for (const r of rows) {
  if (!/^[A-Z]\d{2}$/.test(r.code) || headingSeen.has(r.code)) continue;
  // A category with rows under it, or one whose subcategories come from
  // its block's note (E10-E14, see `expanded`).
  if (r.leaf && !expanded.has(r.id)) continue;
  headingSeen.add(r.code);
  categoryHeadings.push({ code: r.code, nameRu: headingName(r.name) });
}
blocks.sort((a, b) => a.range.localeCompare(b.range, "en") || a.parent.localeCompare(b.parent, "en"));
categoryHeadings.sort((a, b) => a.code.localeCompare(b.code, "en"));
const dashedHeadings = [...blocks, ...categoryHeadings].filter((h) => /[—–]/.test(h.nameRu));
if (dashedHeadings.length > 0) {
  console.error(`Headings with a dash: ${dashedHeadings.map((h) => h.range ?? h.code).join(", ")}`);
  process.exit(1);
}

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

writeFileSync(OUT_BLOCKS, `${JSON.stringify({ blocks, headings: categoryHeadings }, null, 0)}\n`, "utf8");

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
 * A leaf whose own wording only continues its category («Головного мозга над
 * мозговым наметом») carries the category's words, so every name is a
 * diagnosis on its own and no two codes share one. Categories the book
 * subdivides in a block note (E10-E14) carry those subcategories, and the
 * COVID-19 codes of chapter U, which the dump predates, are added.
 *
 * Server code only: the payload is 1.4 MB, and a client component that
 * imports it ships all of it to the browser (audit CT-11). Browsers read the
 * catalog through /api/crm/icd10/search.
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
console.log(`мусорных строк:     ${junk}`);
console.log(`переносов собрано:  ${repaired.length}`);
for (const r of repaired) console.log(`  ${r}`);
console.log(`с контекстом рубрики: ${composed}`);
console.log(`рубрик с общим 4-м знаком: ${expanded.size}`);
console.log(`добавлено вручную:  ${SUPPLEMENT.length}`);
console.log(`кодов записано:     ${entries.length}`);
console.log(
  `по главам:          ${Object.entries(byChapter)
    .sort()
    .map(([k, v]) => `${k}:${v}`)
    .join(" ")}`,
);
console.log(`блоков:             ${blocks.length}`);
console.log(`рубрик с подрубриками: ${categoryHeadings.length}`);
console.log(`→ ${OUT_JSON}`);
console.log(`→ ${OUT_TS}`);
console.log(`→ ${OUT_BLOCKS}`);
