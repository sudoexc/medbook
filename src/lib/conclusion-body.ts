/**
 * Template text in the conclusion body, without an editor on screen.
 *
 * A clinical protocol (its «шаблон заключения») and a doctor's preset with a
 * note template add their text to the conclusion; removing the preset's
 * chip takes it out again. That used to happen inside the visit screen's
 * conclusion editor. The editor is gone (clinic request 03.10.2026), the
 * templates still belong in the signed document, so the same edits now run
 * on the saved body. Pure: the reception's template channel and the tests
 * share them.
 *
 * Without the editor the doctor needs another way to take a template out
 * (review of 03.10.2026): a protocol's template leaves with the diagnosis
 * it came from (`orphanedProtocolTemplates`), and «Предпросмотр» names the
 * templates the text holds, each with «Убрать текст шаблона»
 * (`templatesInBody`).
 */

/**
 * `body` with `text` appended as its own paragraph, unless the body already
 * holds it as a paragraph. A protocol applied a second time (the button
 * stays on the diagnosis row) used to write its conclusion template twice:
 * the editor that let the doctor delete the copy has left the visit screen,
 * so the note was signed and printed with it twice, under a dialog that
 * promises «дубликаты не добавляются», while its drugs and advice were
 * deduplicated (review of 03.10.2026).
 */
export function appendSnippet(body: string, text: string): string {
  const snippet = text.trim();
  if (!snippet) return body;
  if (hasSnippetParagraph(body, snippet)) return body;
  return body.trim() ? `${body}\n\n${snippet}` : snippet;
}

/**
 * Whether `snippet` stands in `body` as whole lines: starts at the body's
 * start or after a line break, ends at its end or before one. A short
 * template that merely occurs inside a sentence of the doctor's own text
 * does not count, so it is still added. Line endings and the spaces at the
 * ends of lines are not compared.
 */
export function hasSnippetParagraph(body: string, snippet: string): boolean {
  return findSnippetLines(linesOf(body), snippet) !== null;
}

/** One line of a text as it is stored, with the break that ends it. */
type Line = { text: string; end: string };

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  const breaks = /\r\n|\r|\n/g;
  let start = 0;
  for (let m = breaks.exec(text); m; m = breaks.exec(text)) {
    out.push({ text: text.slice(start, m.index), end: m[0] });
    start = m.index + m[0].length;
  }
  out.push({ text: text.slice(start), end: "" });
  return out;
}

/** A line as the comparison reads it: without the spaces at its ends. */
function bareLine(line: string): string {
  return line.replace(/^[ \t]+|[ \t]+$/g, "");
}

/**
 * The first place `snippet` stands in the body as whole lines: the index of
 * its first line and how many lines it takes, or null. The one rule every
 * helper here shares (adding, finding, removing), so a template the
 * preview names is the one a removal takes out, and a template inside a
 * sentence of the doctor's own text is neither found nor cut out of it.
 */
function findSnippetLines(
  lines: readonly Line[],
  snippet: string,
): { at: number; count: number } | null {
  const trimmed = normalizeLines(snippet).trim();
  if (!trimmed) return null;
  const want = trimmed.split("\n");
  for (let at = 0; at + want.length <= lines.length; at++) {
    if (want.every((w, k) => bareLine(lines[at + k]!.text) === w)) {
      return { at, count: want.length };
    }
  }
  return null;
}

function normalizeLines(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^[ \t]+|[ \t]+$/gm, "");
}

/**
 * Take the first whole-line occurrence of `snippet` out of `body`, with the
 * blank line that set it apart, so no gap is left where it stood (the
 * "\n\n<snippet>" that `appendSnippet` writes leaves no trace). By the same
 * rule as `appendSnippet` (review of 03.10.2026): the template text inside a
 * sentence of the doctor's own words is his text and stays, so removing
 * «МРТ» never turns «Назначено: МРТ, ЭЭГ.» into «Назначено: , ЭЭГ.». A body
 * that holds the template only that way (or not at all, the doctor edited
 * around it on the conclusion card) comes back unchanged. The snippet is
 * trimmed first, as `appendSnippet` trims what it writes: a template stored
 * with a trailing newline is still found.
 */
export function removeSnippet(body: string, raw: string): string {
  const lines = linesOf(body);
  const found = findSnippetLines(lines, raw);
  if (!found) return body;
  const blank = (i: number) =>
    i >= 0 && i < lines.length && bareLine(lines[i]!.text) === "";
  let from = found.at;
  let to = found.at + found.count;
  if (from === 0) {
    // At the start: the blank line under it goes too.
    if (blank(to)) to += 1;
  } else if (to === lines.length) {
    // At the end: the blank line above it goes too.
    if (blank(from - 1)) from -= 1;
  } else if (blank(from - 1) && blank(to)) {
    // Between two paragraphs: they keep one blank line, not two.
    to += 1;
  }
  const kept = [...lines.slice(0, from), ...lines.slice(to)];
  const last = kept.at(-1);
  if (last && to === lines.length) {
    // The removed lines ended the body: the line now last ends it.
    kept[kept.length - 1] = { ...last, end: "" };
  }
  return kept.map((l) => l.text + l.end).join("");
}

/** A template whose text may sit in the conclusion, with the name it goes by. */
export type BodyTemplate = { name: string; text: string };

/**
 * The templates whose text the body holds as whole lines, each text once,
 * in the given order: what «Предпросмотр» offers to take out again, and
 * what a removed diagnosis takes with it. Found by the rule `removeSnippet`
 * removes by: a template that only occurred inside a sentence of the
 * doctor's text was offered as «Убрать текст шаблона», and the removal then
 * cut it out of that sentence (review of 03.10.2026).
 */
export function templatesInBody(
  body: string,
  templates: readonly BodyTemplate[],
): BodyTemplate[] {
  const lines = linesOf(body);
  const out: BodyTemplate[] = [];
  const seen = new Set<string>();
  for (const t of templates) {
    const text = t.text.trim();
    if (!text || seen.has(text) || !findSnippetLines(lines, text)) continue;
    seen.add(text);
    out.push({ name: t.name, text });
  }
  return out;
}

/** What `orphanedProtocolTemplates` needs of a clinical protocol. */
export type ProtocolTemplateSource = {
  diagnosisCodePrefix: string;
  conclusionTemplateMd: string | null;
  name: string;
};

/**
 * The conclusion templates diagnoses take with them when they leave the
 * visit: those of their protocols that no diagnosis still on the visit
 * calls for (a protocol answers every code its prefix starts, as the
 * protocols route matches them), each text once. Making another diagnosis
 * the main one keeps the old one on the visit, so it keeps its template
 * too; only a removal takes it out.
 */
export function orphanedProtocolTemplates(args: {
  /** The ICD codes still on the visit. */
  codes: readonly string[];
  /** The protocols of the codes that left. */
  protocols: readonly ProtocolTemplateSource[];
}): BodyTemplate[] {
  const codes = args.codes.map((c) => c.trim().toUpperCase()).filter(Boolean);
  const out: BodyTemplate[] = [];
  const seen = new Set<string>();
  for (const p of args.protocols) {
    const text = (p.conclusionTemplateMd ?? "").trim();
    const prefix = p.diagnosisCodePrefix.trim().toUpperCase();
    if (!text || seen.has(text)) continue;
    if (codes.some((c) => c.startsWith(prefix))) continue;
    seen.add(text);
    out.push({ name: p.name, text });
  }
  return out;
}
