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
 */

/** `body` with `text` appended as its own paragraph. */
export function appendSnippet(body: string, text: string): string {
  const snippet = text.trim();
  if (!snippet) return body;
  return body.trim() ? `${body}\n\n${snippet}` : snippet;
}

/**
 * Strip the first occurrence of `snippet` from `body`, preferring the
 * "\n\n<snippet>" form that `appendSnippet` writes. If neither form is
 * present (the doctor edited around it on the conclusion card), returns the
 * body unchanged.
 */
export function removeSnippet(body: string, snippet: string): string {
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
