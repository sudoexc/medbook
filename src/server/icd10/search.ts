/**
 * Ranked ICD-10 lookup.
 *
 * The catalog went from a hand-curated 465 entries to the full 10 414, which
 * breaks the old approach rather than improving it: scanning in catalog order
 * and stopping at the first N matches returns whatever sorts earliest by code,
 * not what the doctor meant. Typing «мигрень» would surface codes from chapter
 * A before the migraine ones in G43.
 *
 * So matches are scored and the best ones win. Per query word, highest first:
 *   - the word itself, first in the name («мигрень» → «Мигрень без ауры»)
 *   - the word itself, anywhere in the name
 *   - a name word that starts with it (typeahead: «мигр» → «Мигрень»)
 *   - the same word in another case («аура» → «с аурой»)
 *   - a longer word sharing its stem, or a compound containing it
 * and across the whole query, highest band first:
 *   - exact code («G43.0»), then code prefix («G43»)
 *   - literal matches on every word, with the clinic's usual code for that
 *     phrase leading them (see SPOKEN_FORMS)
 *   - the codes a spoken form names when the classifier words it differently
 *   - a spoken form found inside a longer query
 *   - literal matches on some of the words, as long as they are not only
 *     region words («шейного отдела») and not a tumour site the query never
 *     called a tumour
 * Ties break on code so the order is stable between identical queries.
 *
 * Normalisation folds ё→е and case. Cyrillic ё is typed inconsistently and
 * costing a doctor a result over a diacritic is not acceptable mid-visit.
 */
import { ICD10_ENTRIES, type Icd10Entry } from "./data";

type SpokenForm = {
  /** Codes the phrase names, the clinic's usual pick first. */
  codes?: readonly string[];
  /**
   * Official wording, for a family too wide to list code by code. Matched as
   * whole words of the name, all of them.
   */
  phrases?: readonly string[];
};

/**
 * What the doctor says → what the classifier calls it.
 *
 * The register's wording is official; the clinic's is spoken. «ТИА»,
 * «люмбалгия», «ДЭП», «грыжа диска» find nothing (or the wrong chapter)
 * against the raw catalog: the code is in there, under a name nobody uses out
 * loud. Most forms name their codes directly, which is precise where a phrase
 * expansion was not: «сотрясение мозга» used to expand to «внутричерепная
 * травма» and put S06.7 (prolonged coma) above the concussion itself.
 *
 * Keys written in CAPITALS are abbreviations. They match whole words only,
 * both as a key and as a literal search word, so «ТИА» never reaches тиамин
 * and «ХИМ» never reaches химические ожоги.
 *
 * Every code here must exist in data.json (a unit test checks), and they are
 * the standard ICD-10 rubrics a Russian-speaking neurologist writes for the
 * phrase. Matching is by word stems, so one key covers its case forms
 * («грыжа диска», «грыжи диска»); «нейро»/«невро» spellings are folded
 * before lookup, see `foldSpelling`.
 */
export const SPOKEN_FORMS: Readonly<Record<string, SpokenForm>> = {
  // Cerebrovascular.
  ТИА: { codes: ["G45.9", "G45.8"] },
  ВБН: { codes: ["G45.0"] },
  "вертебробазилярная недостаточность": { codes: ["G45.0"] },
  ОНМК: { codes: ["I64", "I63.9", "I61.9"] },
  "ишемический инсульт": { codes: ["I63.9"] },
  "геморрагический инсульт": { codes: ["I61.9"] },
  "последствия инсульта": { codes: ["I69.4", "I69.3"] },
  "последствия ишемического инсульта": { codes: ["I69.3"] },
  "последствия геморрагического инсульта": { codes: ["I69.1"] },
  "последствия онмк": { codes: ["I69.4", "I69.3"] },
  ДЭП: { codes: ["I67.8", "I67.9"] },
  дисциркуляторная: { codes: ["I67.8", "I67.9"] },
  "дисциркуляторная энцефалопатия": { codes: ["I67.8", "I67.9"] },
  ХИМ: { codes: ["I67.8"] },
  "хроническая ишемия мозга": { codes: ["I67.8"] },
  "хроническая ишемия головного мозга": { codes: ["I67.8"] },
  ЦВБ: { codes: ["I67.9", "I67.8"] },
  "гипертоническая энцефалопатия": { codes: ["I67.4"] },
  "атеросклероз сосудов мозга": { codes: ["I67.2"] },
  "атеросклероз сосудов головного мозга": { codes: ["I67.2"] },

  // Headache.
  цефалгия: { codes: ["G44.2", "G44.1", "G44.8", "R51"] },
  ГБН: { codes: ["G44.2"] },
  "головная боль напряжения": { codes: ["G44.2"] },
  "кластерная головная боль": { codes: ["G44.0"] },
  "пучковая головная боль": { codes: ["G44.0"] },
  "абузусная головная боль": { codes: ["G44.4"] },
  "лекарственная головная боль": { codes: ["G44.4"] },

  // Vertigo.
  вертиго: { codes: ["R42", "H81.1", "H81.4"] },
  головокружение: { codes: ["R42", "H81.1", "H81.4", "H81.3"] },
  ДППГ: { codes: ["H81.1"] },
  "доброкачественное пароксизмальное головокружение": { codes: ["H81.1"] },
  "доброкачественное пароксизмальное позиционное головокружение": {
    codes: ["H81.1"],
  },
  вестибулопатия: { codes: ["H81.9", "H81.3"] },

  // Spine and back pain.
  "боль в шее": { codes: ["M54.2"] },
  "боль шеи": { codes: ["M54.2"] },
  цервикокраниалгия: { codes: ["M53.0"] },
  цервикобрахиалгия: { codes: ["M53.1"] },
  торакалгия: { codes: ["M54.6"] },
  люмбалгия: { codes: ["M54.5"] },
  "боль в пояснице": { codes: ["M54.5"] },
  "боль в спине": { codes: ["M54.5", "M54.9"] },
  люмбоишиалгия: { codes: ["M54.4"] },
  ишиалгия: { codes: ["M54.3"] },
  радикулит: { codes: ["M54.1"] },
  прострел: { phrases: ["люмбаго"] },
  остеохондроз: { codes: ["M42.1", "M42.9"] },
  "шейный остеохондроз": { codes: ["M42.1", "M42.9"] },
  "остеохондроз шейного отдела": { codes: ["M42.1", "M42.9"] },
  "грудной остеохондроз": { codes: ["M42.1", "M42.9"] },
  "остеохондроз грудного отдела": { codes: ["M42.1", "M42.9"] },
  "поясничный остеохондроз": { codes: ["M42.1", "M42.9"] },
  "остеохондроз поясничного отдела": { codes: ["M42.1", "M42.9"] },
  "грыжа диска": { codes: ["M51.1", "M51.2", "M50.2"] },
  "грыжа межпозвоночного диска": { codes: ["M51.1", "M51.2", "M50.2"] },
  "межпозвоночная грыжа": { codes: ["M51.1", "M51.2", "M50.2"] },
  протрузия: { codes: ["M51.1", "M51.2", "M50.2"] },
  "протрузия диска": { codes: ["M51.1", "M51.2", "M50.2"] },
  "грыжа шейного отдела": { codes: ["M50.2", "M50.1"] },
  "шейная грыжа": { codes: ["M50.2", "M50.1"] },
  "грыжа поясничного отдела": { codes: ["M51.1", "M51.2"] },
  "поясничная грыжа": { codes: ["M51.1", "M51.2"] },
  спондилоартроз: { codes: ["M47.8", "M47.9"] },
  "стеноз позвоночного канала": { codes: ["M48.0"] },

  // Peripheral nerves.
  полинейропатия: { codes: ["G62.9", "G63.2*"] },
  карпальный: { codes: ["G56.0"] },
  "карпальный синдром": { codes: ["G56.0"] },
  "туннельный синдром": { codes: ["G56.0"] },
  "карпальный туннельный синдром": { codes: ["G56.0"] },
  "синдром карпального канала": { codes: ["G56.0"] },
  "неврит лицевого нерва": { codes: ["G51.0", "G51.9"] },
  "нейропатия лицевого нерва": { codes: ["G51.0", "G51.9"] },
  "паралич лицевого нерва": { codes: ["G51.0", "G51.9"] },
  "межреберная невралгия": { codes: ["G58.0"] },
  "неврит седалищного нерва": { codes: ["G57.0"] },
  "нейропатия седалищного нерва": { codes: ["G57.0"] },
  "синдром грушевидной мышцы": { codes: ["G57.0"] },
  "защемление нерва": { phrases: ["сдавления нервных корешков"] },
  "ущемление нерва": { phrases: ["сдавления нервных корешков"] },

  // Autonomic and neurotic.
  ВСД: { codes: ["G90.8", "G90.9", "F45.3"] },
  СВД: { codes: ["G90.8"] },
  НЦД: { codes: ["F45.3"] },
  вегетососудистая: { codes: ["G90.8", "G90.9", "F45.3"] },
  "вегетососудистая дистония": { codes: ["G90.8", "G90.9", "F45.3"] },
  "вегето-сосудистая": { codes: ["G90.8", "G90.9", "F45.3"] },
  "вегето-сосудистая дистония": { codes: ["G90.8", "G90.9", "F45.3"] },
  невроз: { codes: ["F48.9", "F48.8"] },
  "тревожно-депрессивный синдром": { codes: ["F41.2"] },
  "тревожно-депрессивное расстройство": { codes: ["F41.2"] },
  "паническая атака": { codes: ["F41.0"] },
  бессонница: { codes: ["G47.0", "F51.0"] },
  инсомния: { codes: ["G47.0", "F51.0"] },

  // Head injury.
  "сотрясение мозга": { codes: ["S06.0"] },
  СГМ: { codes: ["S06.0"] },
  ЧМТ: { codes: ["S06.9", "S06.0"] },
  "последствия чмт": { codes: ["T90.5"] },
  "последствия черепно-мозговой травмы": { codes: ["T90.5"] },

  // Other.
  ДЦП: { codes: ["G80.9"] },
};

/**
 * Words that match everything and therefore mean nothing here. Without this
 * «прострел в пояснице» scored every row carrying «в» — the search answered
 * with cholera.
 *
 * «с», «со» and «без» are deliberately NOT here: they flip the meaning of the
 * word after them («мигрень с аурой» vs «мигрень без ауры»), so they are read
 * as polarity markers instead of being thrown away (see `tokenize`).
 */
const STOP_WORDS = new Set([
  "в", "во", "и", "на", "по", "при", "для", "от", "до",
  "из", "у", "к", "о", "об", "не", "или",
]);
const NEGATION = "без";
const WITH = new Set(["с", "со"]);

export function normalizeIcdTerm(s: string): string {
  return s.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

/**
 * Spelling variants the classifier never uses. The register writes
 * «полиневропатия», doctors write «полинейропатия» as often as not, and the
 * query used to come back empty. Applied to both sides, only for matching:
 * `normalizeIcdTerm` also keys the clinic-learned catalog and stays as is.
 */
function foldSpelling(s: string): string {
  return s.replace(/нейропат/g, "невропат");
}

/**
 * Russian case endings, longest first so "ами" strips before "ми".
 *
 * Not a real stemmer — deliberately. A doctor types «аура» while the
 * classifier says «с аурой»; plain substring matching fails there, because
 * "аурой" does not contain "аура". Chopping a suffix off both sides makes
 * them meet at "аур". Getting this wrong costs a missed diagnosis code
 * mid-visit, so the list stays conservative: only endings that are almost
 * always inflection, and only on words long enough that the stem survives.
 */
const RU_ENDINGS = [
  "ами", "ями", "ого", "его", "ому", "ему", "ыми", "ими", "ей", "ой", "ый",
  "ий", "ая", "яя", "ое", "ее", "ые", "ие", "ов", "ев", "ам", "ям", "ах",
  "ях", "ом", "ем", "у", "ю", "а", "я", "ы", "и", "е", "о", "ь",
];

/**
 * Strip inflectional endings down to a stable stem, keeping ≥3 characters.
 *
 * Applied repeatedly rather than once, because one pass is not idempotent and
 * that breaks matching asymmetrically: «переломами» reduces to «перелом»,
 * which still ends in a listed ending, while a query of «перелом» would have
 * stopped there. The two sides then never meet. Looping to a fixed point makes
 * both land on the same stem regardless of which form was typed.
 */
export function stemRu(word: string): string {
  let cur = word;
  // Bounded: every iteration shortens the string, so it cannot spin.
  for (;;) {
    if (cur.length <= 3) return cur;
    const end = RU_ENDINGS.find(
      (e) => cur.length - e.length >= 3 && cur.endsWith(e),
    );
    if (!end) return cur;
    cur = cur.slice(0, -end.length);
  }
}

/**
 * Where a word stands relative to «без» / «с». `neg` = under «без» («мигрень
 * без ауры»: «ауры» is neg), `pos` = under «с», `any` = neither.
 */
type Polarity = "neg" | "pos" | "any";

type Token = { text: string; stem: string; pol: Polarity };

/**
 * Words with the polarity each one carries, for a catalog name and a query
 * alike. «без» and «с» govern the words after them until the clause ends: a
 * comma or bracket, or another preposition («без ауры при беременности»
 * does not negate the pregnancy). «и» continues the clause
 * («без психотических и ...»). The markers themselves stay in the list so a
 * name's word positions are unchanged.
 */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let mode: Polarity = "any";
  for (const raw of foldSpelling(text).match(/[a-zа-я0-9]+|[,;:()[\]]/g) ?? []) {
    if (!/[a-zа-я0-9]/.test(raw)) {
      mode = "any";
      continue;
    }
    const pol = mode;
    if (raw === NEGATION) mode = "neg";
    else if (WITH.has(raw)) mode = "pos";
    else if (STOP_WORDS.has(raw) && raw !== "и") mode = "any";
    out.push({ text: raw, stem: stemRu(raw), pol });
  }
  return out;
}

function isMarker(word: string): boolean {
  return word === NEGATION || WITH.has(word);
}

/** Query words worth matching on: not stop words, long enough to mean it. */
function significantTokens(tokens: Token[]): Token[] {
  const kept = tokens.filter(
    (t) => t.text.length >= 3 && !STOP_WORDS.has(t.text) && !isMarker(t.text),
  );
  return kept.length > 0 ? kept : tokens.filter((t) => !isMarker(t.text));
}

/** Content words of a spoken-form key, as stems, plus whether it is an abbreviation. */
type CompiledForm = {
  stems: string[];
  abbr: boolean;
  form: SpokenForm;
};

let compiled: CompiledForm[] | null = null;
let abbreviations: Set<string> | null = null;

function getForms(): CompiledForm[] {
  if (compiled) return compiled;
  compiled = Object.entries(SPOKEN_FORMS).map(([key, form]) => ({
    stems: significantTokens(tokenize(normalizeIcdTerm(key))).map((t) => t.stem),
    // «ТИА» in the source: every letter a capital, more than one of them.
    abbr: key.length > 1 && key === key.toUpperCase() && key !== key.toLowerCase(),
    form,
  }));
  abbreviations = new Set(
    compiled.filter((f) => f.abbr).map((f) => f.stems.join(" ")),
  );
  return compiled;
}

function isAbbreviation(word: string): boolean {
  getForms();
  return abbreviations!.has(word);
}

type FormHit = { form: SpokenForm; direct: boolean };

/**
 * How many query words a multi-word form may step over between two of its
 * own. The standard follow-up wording is «последствия перенесенного ОНМК»:
 * requiring the key's words back to back missed «последствия онмк» there and
 * left only the bare «ОНМК», whose acute codes then led the list at a
 * follow-up visit. Two covers «последствия перенесенного ишемического
 * инсульта» while keeping the words of one form in one phrase.
 */
const MAX_FORM_GAP = 2;

/**
 * Query positions of the key's stems, in the key's order with at most
 * `MAX_FORM_GAP` other words between neighbours, or null. Backtracks, so an
 * early repeat of a stem cannot hide a later occurrence that fits.
 */
function matchForm(key: readonly string[], q: readonly Token[]): number[] | null {
  const walk = (ki: number, from: number, to: number): number[] | null => {
    for (let qi = from; qi <= Math.min(to, q.length - 1); qi += 1) {
      if (q[qi]!.stem !== key[ki]) continue;
      if (ki === key.length - 1) return [qi];
      const rest = walk(ki + 1, qi + 1, qi + 1 + MAX_FORM_GAP);
      if (rest) return [qi, ...rest];
    }
    return null;
  };
  return walk(0, 0, q.length - 1);
}

/**
 * Spoken forms in the query, matched on whole-word stems. `direct` = the
 * query IS the form («грыжа диска»); otherwise the form sits inside a longer
 * query («грыжа диска шейного отдела»). Word boundaries are the point: the old
 * substring check found «тиа» inside «тиамин» and offered TIA codes for a
 * vitamin.
 *
 * A form whose words all belong to a longer form that also matched is
 * dropped: «последствия онмк» says what the doctor means, and the «ОНМК»
 * inside it would otherwise add acute stroke codes to a sequelae query.
 */
function findSpokenForms(query: Token[]): FormHit[] {
  const q = significantTokens(query);
  const found: { form: SpokenForm; at: number[] }[] = [];
  for (const f of getForms()) {
    if (f.stems.length === 0 || f.stems.length > q.length) continue;
    const at = matchForm(f.stems, q);
    if (at) found.push({ form: f.form, at });
  }
  return found
    .filter(
      (h) =>
        !found.some(
          (o) => o.at.length > h.at.length && h.at.every((p) => o.at.includes(p)),
        ),
    )
    .map((h) => ({ form: h.form, direct: h.at.length === q.length }));
}

/**
 * Codes and official wording the query's spoken forms stand for. `direct` =
 * the whole query is a known spoken form, the strongest signal there is.
 */
export function expandSynonyms(rawQuery: string): {
  codes: string[];
  phrases: string[];
  direct: boolean;
} {
  const hits = findSpokenForms(tokenize(normalizeIcdTerm(rawQuery)));
  return {
    codes: [...new Set(hits.flatMap((h) => h.form.codes ?? []))],
    phrases: [...new Set(hits.flatMap((h) => h.form.phrases ?? []))],
    direct: hits.some((h) => h.direct),
  };
}

/**
 * Pre-normalised mirror of the catalog, built once per process. 10k rows is
 * cheap to hold but not cheap to lowercase on every keystroke of every
 * doctor — and the picker fires on each character.
 */
type Indexed = {
  entry: Icd10Entry;
  code: string;
  /** Every word of the name, in order, with its stem and polarity. */
  tokens: Token[];
  /** Chapter II, neoplasms (C00–D48). See `namesTumour`. */
  neoplasm: boolean;
};

let index: Indexed[] | null = null;
let byCode: Map<string, Indexed> | null = null;

function getIndex(): Indexed[] {
  if (index) return index;
  index = ICD10_ENTRIES.map((entry) => ({
    entry,
    code: entry.code.toLowerCase(),
    tokens: tokenize(normalizeIcdTerm(entry.nameRu)),
    neoplasm: /^(c\d|d[0-4]\d)/i.test(entry.code),
  }));
  byCode = new Map(index.map((r) => [r.code, r]));
  return index;
}

/**
 * Where the problem is, never what it is: spinal regions, limbs, sides.
 * The doctor adds them to a diagnosis («дорсопатия шейного отдела»); on
 * their own they match sprains, fractures and oesophageal cancer just as
 * well as the spine. A partial match carried only by these words is noise
 * as long as another query word found something (see `searchIcd10`).
 * Kept as stems, so every case form of a listed word counts.
 */
const REGION_STEMS = new Set(
  [
    "шейный", "грудной", "поясничный", "крестцовый", "копчиковый", "отдел",
    "позвоночник", "позвоночный", "позвонок", "позвонка", "левый", "правый",
    "левосторонний", "правосторонний", "двусторонний", "слева", "справа",
    "верхний", "нижний", "конечность",
  ].map(stemRu),
);

function isRegionWord(t: Token): boolean {
  // `stemRu` keeps the plural genitive («нижних», «шейных»): drop it first.
  return REGION_STEMS.has(t.stem) || REGION_STEMS.has(stemRu(t.text.replace(/[ыи]х$/, "")));
}

/**
 * The query asks about a tumour. Without one of these words, a query that
 * only partly matches a chapter II row matched it on anatomy: the names there
 * are sites («Шейного отдела пищевода», «Спинного мозга», «Слухового нерва»)
 * whose «Злокачественное новообразование» lives in a heading the catalog
 * leaves out, so «ишемия спинного мозга» put C72.0 first. «Образование»
 * counts, because «объемное образование головного мозга» is how a lesion is
 * written before histology names it.
 */
const TUMOUR_WORD =
  /^рак(а|у|ом|е|и|ов)?$|опухол|новообраз|образован|злокачеств|онко|метастаз|карцином|сарком|лимфом|лейкоз|лейкем|меланом|миелом|бластом|глиом|астроцитом|менингиом|неврином|шванном|аденом|эпендимом|гемангиом|папиллом|липом|фибром|хордом|краниофарингиом|ходжкин/;

function namesTumour(tokens: Token[]): boolean {
  return tokens.some((t) => TUMOUR_WORD.test(t.text));
}

/**
 * The shortest word that may match as a prefix of a longer one when it is
 * not the word still being typed. «боль» is a whole word and must not reach
 * «больших»; «остеохондр» can only mean one thing.
 */
const MIN_PREFIX = 5;

const WORD = {
  /**
   * Bonus for the name's first word, literal matches only: «Мигрень без
   * ауры» over «Другая мигрень».
   */
  first: 20,
  exact: 45,
  prefix: 40,
  /** Same word in another case («аура» vs «аурой»). */
  inflected: 35,
  /** A longer word sharing a long stem («ишемия» vs «ишемическая»). */
  stemPrefix: 25,
  /** Inside a compound: «невропатия» in «полиневропатия». */
  infix: 20,
} as const;

type QueryWord = Token & {
  /** A curated abbreviation: whole-word matches only. */
  abbr: boolean;
  /** May match the start of a longer word. */
  prefix: boolean;
  /** Says where, not what: see `REGION_STEMS`. */
  region: boolean;
};

/**
 * How well one query word matches the name; 0 = not at all.
 *
 * Prefixes are where the old search went wrong: «боль» matched «Большой
 * слюнной железы» and «ТИА» matched «тиамина», because any word starting
 * with the term counted. Now a prefix only counts while the word may still
 * be half typed (the query's last word) or once it is long enough to be
 * unambiguous, and the whole word always outranks it.
 */
function wordScore(row: Indexed, q: QueryWord): number {
  let best = 0;
  row.tokens.forEach((w, i) => {
    // «без ауры» only matches a name that also says «без ауры», and
    // «аура» / «с аурой» never matches one that does.
    if ((q.pol === "neg") !== (w.pol === "neg")) return;
    const first = i === 0 ? WORD.first : 0;
    let s = 0;
    if (w.text === q.text) s = WORD.exact + first;
    else if (q.abbr) s = 0;
    else if (q.prefix && w.text.startsWith(q.text)) s = WORD.prefix + first;
    // No first-word bonus from here on: «Сосудистая головная боль» is a
    // better answer to «головная боль» than «Головные боли, вызванные
    // спинномозговой анестезией».
    else if (w.stem === q.stem) s = WORD.inflected;
    else if (q.stem.length >= MIN_PREFIX && w.stem.startsWith(q.stem)) {
      s = WORD.stemPrefix;
    } else if (q.text.length >= MIN_PREFIX && w.text.includes(q.text)) {
      s = WORD.infix;
    }
    // Both sides said «с» (or both «без»): the marker itself matched too.
    if (s > 0 && q.pol !== "any" && q.pol === w.pol) s += 2;
    if (s > best) best = s;
  });
  return best;
}

/** Score bands. A band always beats everything below it, whatever the in-band score. */
const BAND = {
  exactCode: 1000,
  codePrefix: 800,
  /** A code the spoken form names that ALSO matches every word literally. */
  promoted: 400,
  /** Every query word matched literally. */
  full: 300,
  /** The whole query is a spoken form; these are its codes. */
  spokenCode: 200,
  /** The whole query is a spoken form; these rows carry its official wording. */
  spokenPhrase: 150,
  /** A spoken form inside a longer query. */
  spokenInside: 100,
} as const;

type Scored = {
  entry: Icd10Entry;
  code: string;
  score: number;
  full: boolean;
  /** A partial match that found only region words (see `REGION_STEMS`). */
  regionOnly: boolean;
};

type Literal = { score: number; full: boolean; regionOnly: boolean };

/** Literal score of one row: a full match, a partial one, or nothing. */
function literalScore(row: Indexed, words: QueryWord[]): Literal {
  const scores = words.map((w) => wordScore(row, w));
  const matched = scores.filter((s) => s > 0).length;
  if (matched === 0) return { score: 0, full: false, regionOnly: false };
  const head = scores[0]!;
  const sum = scores.reduce((a, b) => a + b, 0);
  if (matched === words.length) {
    return { score: BAND.full + head + (sum - head) / 10, full: true, regionOnly: false };
  }
  // Partial matching, but full matches always win. Requiring every word
  // meant «остеохондроз шейного отдела» returned NOTHING while
  // «остеохондроз» alone returned 17 codes — the classifier does not
  // spell the region the way the doctor does. More words matched ranks
  // higher; the spoken forms, not word order, say which word is the
  // diagnosis («шейный остеохондроз» leads with the adjective). Which
  // partial matches are allowed at all is decided in `searchIcd10`.
  return {
    score: sum / words.length + matched,
    full: false,
    regionOnly: scores.every((s, i) => s === 0 || words[i]!.region),
  };
}

export function searchIcd10(rawQuery: string, limit: number): Icd10Entry[] {
  const term = normalizeIcdTerm(rawQuery);
  const rows = getIndex();

  if (!term) {
    // No query: the picker still wants something on screen. Catalog order
    // starts at chapter A (infectious disease), which is noise for most
    // clinics — return nothing rather than a misleading default, and let the
    // UI show its hint instead.
    return [];
  }

  const tokens = tokenize(term);
  const significant = significantTokens(tokens);
  const words: QueryWord[] = significant.map((t, i) => ({
    ...t,
    abbr: isAbbreviation(t.text),
    prefix: i === significant.length - 1 || t.text.length >= MIN_PREFIX,
    region: isRegionWord(t),
  }));
  // «мигрень без» typed so far: lean towards the names that say «без».
  const lastRaw = term.split(/[^a-zа-я0-9]+/).filter(Boolean).pop() ?? "";
  const trailingMarker = isMarker(lastRaw) ? lastRaw : null;
  const tumourQuery = namesTumour(tokens);

  const scored = new Map<string, Scored>();
  for (const row of rows) {
    let score = 0;
    let full = false;
    let regionOnly = false;
    if (row.code === term) score = BAND.exactCode;
    else if (row.code.startsWith(term)) score = BAND.codePrefix;
    else if (words.length > 0) {
      ({ score, full, regionOnly } = literalScore(row, words));
      // A tumour site reached by part of a query that names no tumour was
      // reached on anatomy alone (see `TUMOUR_WORD`). A full match still
      // counts: «спинного мозга» lists C72.0 among the others.
      if (row.neoplasm && !full && !tumourQuery) score = 0;
      if (
        score > 0 &&
        trailingMarker &&
        row.tokens.some((t) => t.text === trailingMarker)
      ) {
        score += 3;
      }
    }
    if (score > 0) {
      scored.set(row.code, { entry: row.entry, code: row.code, score, full, regionOnly });
    }
  }

  // Literal full matches crowd out partial ones: «мигрень аура» narrows
  // instead of widening, which is how people expect search to behave.
  if ([...scored.values()].some((s) => s.full || s.score >= BAND.codePrefix)) {
    for (const [code, s] of scored) {
      if (!s.full && s.score < BAND.codePrefix) scored.delete(code);
    }
  }

  const spoken = findSpokenForms(tokens);

  // «дорсопатия шейного отдела»: the diagnosis word finds M53.9, the region
  // words find every row that says «шейного отдела», and two of them outscore
  // one. Rows reached through region words alone go once any other word has
  // found something, so the sprain and the oesophagus cannot lead. The
  // exception is a category a spoken form in the query names: in «грыжа
  // шейного отдела позвоночника» the M50 siblings of the named M50.2 are the
  // next best answers, not the groin hernias that «грыжа» finds.
  if ([...scored.values()].some((s) => !s.full && !s.regionOnly && s.score < BAND.codePrefix)) {
    const named = new Set(
      spoken.flatMap((h) => (h.form.codes ?? []).map((c) => c.toLowerCase().split(".")[0]!)),
    );
    for (const [code, s] of scored) {
      if (s.regionOnly && !named.has(code.split(".")[0]!)) scored.delete(code);
    }
  }

  // What the doctor MEANT: «ТИА» → G45.9. Always attempted, not only when
  // the literal search came back empty — a spoken form often has noisy
  // literal matches («грыжа» → паховые грыжи) that would otherwise bury the
  // rubric actually being asked for. A literal match on every word still
  // outranks a code reached only through the spoken form. The raw literal
  // score, region words included, orders a form's codes: «протрузия шейного
  // отдела» puts the cervical M50.2 above the lumbar M51.1.
  const literal = (row: Indexed): Literal =>
    words.length > 0 ? literalScore(row, words) : { score: 0, full: false, regionOnly: false };
  const raise = (row: Indexed, score: number) => {
    const existing = scored.get(row.code);
    if (existing) existing.score = Math.max(existing.score, score);
    else {
      scored.set(row.code, {
        entry: row.entry,
        code: row.code,
        score,
        full: false,
        regionOnly: false,
      });
    }
  };
  // The whole query is a phrase we understand: rows matching only some of
  // its words are noise by definition («хроническая ишемия мозга» used to
  // continue with «Хроническая эритремия»).
  if (spoken.some((h) => h.direct)) {
    for (const [code, s] of scored) {
      if (!s.full && s.score < BAND.codePrefix) scored.delete(code);
    }
  }
  for (const { form, direct } of spoken) {
    const codes = form.codes ?? [];
    codes.forEach((code, i) => {
      const row = byCode!.get(code.toLowerCase());
      if (!row) return;
      const order = codes.length - i;
      const lit = literal(row);
      if (lit.full) raise(row, BAND.promoted + order);
      else if (direct) raise(row, BAND.spokenCode + order);
      else raise(row, BAND.spokenInside + lit.score + order / 10);
    });
    for (const phrase of form.phrases ?? []) {
      const need = significantTokens(tokenize(normalizeIcdTerm(phrase)));
      for (const row of rows) {
        const hit = need.every((n) => row.tokens.some((t) => t.text === n.text));
        if (!hit) continue;
        const lit = literal(row);
        raise(
          row,
          direct ? BAND.spokenPhrase + lit.score / 10 : BAND.spokenInside + lit.score,
        );
      }
    }
  }

  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, limit)
    .map((s) => s.entry);
}
