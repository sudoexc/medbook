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

import {
  formatDurationDays,
  formatMealLabel,
  formatPrescriptionHead,
  type PrescriptionLikeRow,
  type PrescriptionLocale,
} from "@/lib/catalogs/prescription-format";

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

// ─────────────────────────────────────────────────────────────────────────────
// Ф5 — medication intake grid («сетка приёма»).
//
// One deterministic model built from structured VisitPrescription rows,
// consumed by both print surfaces: the print route renders it as an HTML
// table, the conclusion-PDF worker draws the same rows with pdfkit. Column
// order is fixed (morning/noon/evening/night) and mirrored in the headers.
// ─────────────────────────────────────────────────────────────────────────────

export type MedicationGridRow = {
  /** Drug head ("Конкор 5 мг"); carries the dose when no time slot is set. */
  name: string;
  /** Locale-resolved instruction line, "" when absent. */
  note: string;
  /** Dose per fixed slot [morning, noon, evening, night]; "" = not taken. */
  cells: [string, string, string, string];
  meal: string;
  duration: string;
};

export type MedicationGrid = {
  headers: {
    drug: string;
    times: [string, string, string, string];
    meal: string;
    duration: string;
  };
  rows: MedicationGridRow[];
};

const GRID_TIME_ORDER = ["MORNING", "NOON", "EVENING", "NIGHT"] as const;

const GRID_HEADERS: Record<PrescriptionLocale, MedicationGrid["headers"]> = {
  ru: {
    drug: "Препарат",
    times: ["Утро", "День", "Вечер", "Ночь"],
    meal: "Еда",
    duration: "Курс",
  },
  uz: {
    drug: "Dori",
    times: ["Ertalab", "Kunduzi", "Kechqurun", "Tunda"],
    meal: "Ovqat",
    duration: "Kurs",
  },
};

export function buildMedicationGrid(
  rows: readonly PrescriptionLikeRow[],
  locale: PrescriptionLocale,
): MedicationGrid {
  return {
    headers: GRID_HEADERS[locale],
    rows: rows.map((row) => {
      const dose = row.dose.trim();
      const cells = GRID_TIME_ORDER.map((t) =>
        row.timesOfDay.includes(t) ? dose : "",
      ) as MedicationGridRow["cells"];
      const head = formatPrescriptionHead(row);
      const note =
        (locale === "uz"
          ? row.instructionUz?.trim() || row.instructionRu?.trim()
          : row.instructionRu?.trim()) ?? "";
      return {
        // No slot selected (e.g. "по требованию") — keep the dose visible
        // by folding it into the name column.
        name: cells.every((c) => c === "") && dose ? `${head} — ${dose}` : head,
        note,
        cells,
        meal: formatMealLabel(row.mealRelation, locale),
        duration: formatDurationDays(row.durationDays, locale),
      };
    }),
  };
}

/** Table HTML for the print route; styling via `.med-grid` classes there. */
export function renderMedicationGridHtml(grid: MedicationGrid): string {
  if (grid.rows.length === 0) return "";
  const h = grid.headers;
  const head = [
    `<th class="med-drug">${escapeHtml(h.drug)}</th>`,
    ...h.times.map((t) => `<th class="med-slot">${escapeHtml(t)}</th>`),
    `<th class="med-meal">${escapeHtml(h.meal)}</th>`,
    `<th class="med-duration">${escapeHtml(h.duration)}</th>`,
  ].join("");
  const body = grid.rows
    .map((row) => {
      const name = row.note
        ? `${escapeHtml(row.name)}<div class="med-note">${escapeHtml(row.note)}</div>`
        : escapeHtml(row.name);
      return `<tr><td class="med-drug">${name}</td>${row.cells
        .map((c) => `<td class="med-slot">${escapeHtml(c)}</td>`)
        .join("")}<td class="med-meal">${escapeHtml(row.meal)}</td><td class="med-duration">${escapeHtml(row.duration)}</td></tr>`;
    })
    .join("");
  return `<table class="med-grid"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
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
