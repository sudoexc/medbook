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
 * `body` with `text` appended as its own paragraph, unless the body holds it
 * already. With the editor gone the doctor cannot see or delete a second
 * copy: a protocol applied twice wrote its template twice into the signed
 * sheet, while its drugs and advice were deduplicated (review of
 * 03.10.2026).
 */
export function appendSnippet(body: string, text: string): string {
  const snippet = text.trim();
  if (!snippet) return body;
  if (body.includes(snippet)) return body;
  return body.trim() ? `${body}\n\n${snippet}` : snippet;
}

/**
 * Strip the first occurrence of `snippet` from `body`, preferring the
 * "\n\n<snippet>" form that `appendSnippet` writes. If neither form is
 * present (the doctor edited around it on the conclusion card), returns the
 * body unchanged. Trimmed first, as `appendSnippet` trims what it writes: a
 * template stored with a trailing newline was never found again.
 */
export function removeSnippet(body: string, raw: string): string {
  const snippet = raw.trim();
  if (!snippet) return body;
  const withSep = "\n\n" + snippet;
  const idxSep = body.indexOf(withSep);
  if (idxSep >= 0) return body.slice(0, idxSep) + body.slice(idxSep + withSep.length);
  // Snippet at the very start (no leading separator) — strip a trailing
  // separator instead so we don't leave a blank line.
  if (body.startsWith(snippet)) {
    const after = body.slice(snippet.length);
    return after.startsWith("\n\n") ? after.slice(2) : after;
  }
  const idx = body.indexOf(snippet);
  if (idx >= 0) return body.slice(0, idx) + body.slice(idx + snippet.length);
  return body;
}

/** A template whose text may sit in the conclusion, with the name it goes by. */
export type BodyTemplate = { name: string; text: string };

/**
 * The templates whose text the body holds, each text once, in the given
 * order: what «Предпросмотр» offers to take out again.
 */
export function templatesInBody(
  body: string,
  templates: readonly BodyTemplate[],
): BodyTemplate[] {
  const out: BodyTemplate[] = [];
  const seen = new Set<string>();
  for (const t of templates) {
    const text = t.text.trim();
    if (!text || seen.has(text) || !body.includes(text)) continue;
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
