/**
 * Review fixes before the visit screen's part one ships (03.10.2026).
 *
 *   [0] A drug already on the visit stays clickable in the picker (and its
 *       search): a course written in two forms («Мексидол 5,0 в/м №10»,
 *       then «Мексидол 125 мг таб») needs the same drug twice. Only the
 *       second click of a double click is ignored.
 *   [1] A protocol applied twice writes its conclusion template once: the
 *       editor that let the doctor delete the copy is gone.
 *   [2] A pick waiting in the dose prompt is never lost: a quick-dose chip
 *       adds the row, a second pick does not replace the first, and the
 *       visit is not signed (nor previewed) while one waits.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  isRepeatClick,
  onVisitChecker,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";
import {
  admitPendingPick,
  isPendingDosePick,
  PendingDosePickError,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";
import { signVisitNoteWhenSaved } from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";
import {
  appendSnippet,
  hasSnippetParagraph,
  removeSnippet,
} from "@/lib/conclusion-body";

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor/reception", rel), "utf8");

// ── [0] The same drug a second time ─────────────────────────────────

describe("[0] a drug on the visit can be added again", () => {
  it("the mark stays: the item is still recognised as on the visit", () => {
    const onVisit = onVisitChecker(
      [{ drugId: "ethylmethylhydroxypyridine", displayName: "Мексидол" }],
      [],
    );
    expect(onVisit({ drugId: "ethylmethylhydroxypyridine", label: "Мексидол" })).toBe(true);
  });

  it("only the repeat clicks of one double click are ignored", () => {
    expect(isRepeatClick(0)).toBe(false); // keyboard
    expect(isRepeatClick(1)).toBe(false); // a click, also a deliberate second one
    expect(isRepeatClick(2)).toBe(true);
    expect(isRepeatClick(3)).toBe(true);
  });

  it("the picker's rows (columns and search alike) are never disabled by the mark", () => {
    const picker = read("_components/prescription-picker.tsx");
    expect(picker).not.toContain("disabled={added}");
    expect(picker).not.toMatch(/added\s*\?\s*"cursor-default/);
    expect(picker).toContain("if (isRepeatClick(e.detail)) return;");
    // The search results go through the same row component.
    const search = picker.slice(picker.indexOf("function SearchResults"));
    expect(search).toContain("<PickerItemRow");
    expect(search).toContain("onPick={() => onPickHit(hit)}");
  });
});

// ── [1] A conclusion template once ──────────────────────────────────

describe("[1] a protocol applied twice writes its template once", () => {
  const template = "Рекомендовано: МРТ головного мозга.\nКонтроль через 14 дней.";

  it("a second append of the same template is a no-op", () => {
    const once = appendSnippet("Осмотр.", template);
    expect(once).toBe(`Осмотр.\n\n${template}`);
    expect(appendSnippet(once, template)).toBe(once);
    // Even after another template landed behind it.
    const two = appendSnippet(once, "Шаблон пресета");
    expect(appendSnippet(two, template)).toBe(two);
    // And in an empty body.
    expect(appendSnippet(appendSnippet("", template), template)).toBe(template);
  });

  it("line endings and spaces at line ends do not make a copy", () => {
    const saved = `Осмотр.\r\n\r\n${template.replace("\n", "  \r\n")}  `;
    expect(appendSnippet(saved, template)).toBe(saved);
    expect(appendSnippet("Осмотр.", `  ${template}\n`)).toBe(`Осмотр.\n\n${template}`);
  });

  it("a template inside a sentence of his own text is still added", () => {
    expect(hasSnippetParagraph("Назначено: МРТ головного мозга, ЭЭГ.", "МРТ головного мозга")).toBe(false);
    expect(appendSnippet("Назначено: МРТ, ЭЭГ.", "МРТ")).toBe("Назначено: МРТ, ЭЭГ.\n\nМРТ");
    expect(hasSnippetParagraph("Осмотр.\nМРТ", "МРТ")).toBe(true);
    expect(hasSnippetParagraph("МРТ\nОсмотр.", "МРТ")).toBe(true);
    expect(hasSnippetParagraph("Осмотр.", "   ")).toBe(false);
  });

  it("removing the preset after a double apply leaves the body clean", () => {
    const body = appendSnippet(appendSnippet("Осмотр.", "Шаблон"), "Шаблон");
    expect(removeSnippet(body, "Шаблон")).toBe("Осмотр.");
  });

  it("the channel appends through the idempotent helper", () => {
    const channel = read("_components/conclusion-template-channel.tsx");
    expect(channel).toContain("edit((body) => appendSnippet(body, text))");
    // An unchanged body sends nothing.
    expect(channel).toContain("if (next === base) return;");
  });
});

// ── [2] A pick waiting for its dose ─────────────────────────────────

describe("[2] a pick waiting in the dose prompt", () => {
  const drops = { drugId: "citicoline", displayName: "Цераксон" };
  const syrup = { drugId: "levetiracetam", displayName: "Кеппра" };

  it("a second pick does not replace the first", () => {
    expect(admitPendingPick(null, drops, "n1")).toBe("open");
    expect(admitPendingPick({ draft: drops, noteId: "n1" }, syrup, "n1")).toBe("busy");
    expect(admitPendingPick({ draft: drops, noteId: "n1" }, drops, "n1")).toBe("same");
    // A pick left on the previous patient's note does not hold this one.
    expect(admitPendingPick({ draft: drops, noteId: "n0" }, syrup, "n1")).toBe("open");
    // Manual rows compare by name; a manual row is never «the same» as a catalog drug.
    const manual = { drugId: null, displayName: "Капли Зеленина" };
    expect(admitPendingPick({ draft: manual, noteId: "n1" }, { ...manual, displayName: " Капли Зеленина " }, "n1")).toBe("same");
    expect(admitPendingPick({ draft: manual, noteId: "n1" }, drops, "n1")).toBe("busy");
    expect(admitPendingPick({ draft: drops, noteId: "n1" }, manual, "n1")).toBe("busy");
  });

  it("signing stops at the flush while a pick waits: nothing read, nothing signed", async () => {
    const readSavedRow = vi.fn();
    const finalize = vi.fn();
    const step = await signVisitNoteWhenSaved({
      noteId: "note_pending_pick",
      flushDraftEdits: async () => {
        throw new PendingDosePickError("Цераксон");
      },
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });
    expect(step.kind).toBe("flushFailed");
    const error = step.kind === "flushFailed" ? step.error : null;
    expect(isPendingDosePick(error)).toBe(true);
    expect((error as PendingDosePickError).displayName).toBe("Цераксон");
    expect(readSavedRow).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    // The second pass from the empty-sections dialog stops there too.
    const again = await signVisitNoteWhenSaved({
      noteId: "note_pending_pick",
      flushDraftEdits: async () => {
        throw new PendingDosePickError("Цераксон");
      },
      readSavedRow,
      finalize,
      emptyConfirmed: true,
    });
    expect(again.kind).toBe("flushFailed");
    expect(finalize).not.toHaveBeenCalled();
    expect(isPendingDosePick(new Error("network"))).toBe(false);
  });

  it("a quick-dose chip in the prompt adds the row, like the row editor's chip", () => {
    const ctor = read("_components/prescription-constructor.tsx");
    const form = ctor.slice(ctor.indexOf("function PendingDoseForm"));
    const chips = form.slice(form.indexOf("{quick.map((dose) =>"), form.indexOf("</SegChip>"));
    expect(chips).toContain("onClick={() => onAdd(dose)}");
    expect(chips).not.toContain("onChange({ ...draft, dose })");
    // The host takes the chip's dose and adds the row with it.
    expect(ctor).toContain("const dose = (chosenDose ?? draft.dose).trim();");
    expect(ctor).toContain("addDraft({ ...draft, dose }, forms);");
  });

  it("the constructor holds the sign flow while a pick waits, and the visit screen wires it", () => {
    const ctor = read("_components/prescription-constructor.tsx");
    expect(ctor).toContain("admitPendingPick(waiting, draft, noteId)");
    expect(ctor).toContain('t("rx.pendingBusy"');
    expect(ctor).toContain("return registerDraftFlush(async () => {");
    expect(ctor).toContain("throw new PendingDosePickError(waiting.draft.displayName);");
    const panel = read("_components/structured-fields-panel.tsx");
    expect(panel).toContain("registerDraftFlush={registerDraftFlush}");
  });

  it("«Завершить визит» and «Предпросмотр» refuse with a toast instead of going on", () => {
    const bar = read("_components/visit-action-bar.tsx");
    expect(bar).toContain("if (isPendingDosePick(step.error)) {");
    const preview = bar.slice(bar.indexOf("const openPreview"), bar.indexOf("const openPreview") + 1400);
    expect(preview).toContain("if (isPendingDosePick(e)) {");
    expect(preview).toContain("open = false;");
    expect(preview).toContain("if (open) setPreviewOpen(true);");
    expect(bar.match(/t\("rx\.pendingBlocksSign"/g)).toHaveLength(2);
  });

  it("the new words exist in ru and uz, name the drug, and carry no dashes", () => {
    for (const loc of ["ru", "uz"]) {
      const m = JSON.parse(
        readFileSync(path.join(process.cwd(), `src/messages/${loc}.json`), "utf8"),
      ) as { doctor: { reception: { rx: Record<string, unknown> & { picker: Record<string, string> } } } };
      const rx = m.doctor.reception.rx;
      for (const key of ["pendingBusy", "pendingBlocksSign"]) {
        const text = rx[key];
        expect(typeof text, `${loc} rx.${key}`).toBe("string");
        expect(text as string, `${loc} rx.${key}`).toContain("{name}");
        expect(text as string, `${loc} rx.${key}`).not.toMatch(/[—–]/);
      }
      expect(rx.picker.onVisit, loc).not.toMatch(/[—–]/);
    }
  });
});
