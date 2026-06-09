/**
 * P1.1 — Shared patient-handout markdown parser.
 *
 * The doctor writes `VisitNote.patientHandoutMarkdown` in a deliberately tiny
 * markdown subset. Two surfaces consume it:
 *
 *   - the print route (`visit-notes/[id]/print`) renders it to HTML for the
 *     browser's Cmd/Ctrl+P → "Save as PDF" flow;
 *   - the `visit-note-handout` worker renders it to a pdfkit PDF that becomes
 *     the patient-facing CONCLUSION document in the Mini App.
 *
 * Both must agree on block structure, so the line-walking lives here once.
 * Inline emphasis is handled per-surface: HTML keeps `<strong>`/`<em>`; the
 * PDF strips the markers because the bundled DejaVuSans has no bold/italic
 * face (a patient handout reads fine without weighted runs).
 *
 * Supported subset (everything the deterministic composer emits):
 *   - `# Heading 1` / `## Heading 2` at the start of a line
 *   - `- bullet` lines collected into one list
 *   - blank-line-separated paragraphs (soft-wrapped lines joined by a space)
 *   - `**bold**`, `_italic_` inline (no nesting)
 */

export type HandoutBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "paragraph"; text: string };

function escapeHtml(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Escape, then re-mark the two inline forms. Escaping first means user-typed
 * HTML in the editable handout cannot inject markup into the printed page —
 * the same guarantee the print route relied on before this was extracted.
 */
function inlineToHtml(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:!?)])/g, "$1<em>$2</em>");
}

/**
 * Strip the inline markers for plain-text targets (PDF). Uses the same italic
 * boundary rule as `inlineToHtml` so a stray underscore mid-word survives
 * exactly as it does in the HTML render.
 */
export function stripInlineMarkers(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:!?)])/g, "$1$2");
}

/** Parse the handout into ordered blocks. Empty input → empty array. */
export function parseHandoutBlocks(markdown: string | null): HandoutBlock[] {
  const src = (markdown ?? "").trim();
  if (!src) return [];

  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: HandoutBlock[] = [];
  let bulletBuf: string[] = [];
  let paragraphBuf: string[] = [];

  const flushBullets = () => {
    if (bulletBuf.length === 0) return;
    blocks.push({ kind: "bullets", items: bulletBuf });
    bulletBuf = [];
  };
  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join(" ").trim();
    if (text) blocks.push({ kind: "paragraph", text });
    paragraphBuf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.length === 0) {
      flushParagraph();
      flushBullets();
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      flushBullets();
      blocks.push({ kind: "h1", text: line.slice(2) });
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushBullets();
      blocks.push({ kind: "h2", text: line.slice(3) });
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      bulletBuf.push(line.slice(2));
      continue;
    }
    flushBullets();
    paragraphBuf.push(line);
  }
  flushParagraph();
  flushBullets();

  return blocks;
}

/**
 * Render the handout to the same inner HTML the print route emitted inline,
 * so extracting this function is a behaviour-preserving refactor. Empty input
 * yields the `—` placeholder the route used as its fallback body.
 */
export function renderHandoutHtml(markdown: string | null): string {
  const blocks = parseHandoutBlocks(markdown);
  if (blocks.length === 0) return `<p class="empty">—</p>`;

  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") {
      out.push(`<h1 class="md-h1">${inlineToHtml(b.text)}</h1>`);
    } else if (b.kind === "h2") {
      out.push(`<h2 class="md-h2">${inlineToHtml(b.text)}</h2>`);
    } else if (b.kind === "bullets") {
      out.push(
        `<ul class="md-list">${b.items
          .map((it) => `<li>${inlineToHtml(it)}</li>`)
          .join("")}</ul>`,
      );
    } else {
      out.push(`<p>${inlineToHtml(b.text)}</p>`);
    }
  }
  return out.join("\n");
}
