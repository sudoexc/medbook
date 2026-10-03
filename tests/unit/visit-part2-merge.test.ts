/**
 * Visit screen part two merged onto part one's review fixes (03.10.2026).
 *
 * The two lines were written side by side from «part one»: its review fixes
 * (a drug clickable again, a double-click guard, an idempotent template, a
 * pick waiting for its dose never lost) and part two («Обычно при», the
 * diagnosis picker) each assumed the other's code as it was before. These
 * pin where they meet.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { appendSnippet, removeSnippet, templatesInBody } from "@/lib/conclusion-body";
import {
  isRepeatClick,
  onVisitChecker,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-columns";

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor/reception", rel), "utf8");

describe("«Добавить всё» and a pick already waiting for its dose", () => {
  const ctor = read("_components/prescription-constructor.tsx");
  const addItems = ctor.slice(
    ctor.indexOf("const addItems = (items: readonly DrugShortItem[]) => {"),
    ctor.indexOf("const addClinicDrug = useAddClinicDrug();"),
  );

  it("its dose-less row goes through the single pick's path", () => {
    expect(addItems.length).toBeGreaterThan(0);
    // addDraft admits it (admitPendingPick): a pick already waiting stays,
    // a toast names it, and the sign check reads it from the ref.
    expect(addItems).toContain("if (needsDose) addDraft(needsDose.draft, needsDose.forms);");
    // Never straight into the prompt, past the admission check.
    expect(addItems).not.toContain("setPending(");
  });

  it("the rows still go in one save, and a single pick still opens its row", () => {
    expect(addItems).toContain("onSaveRows([...liveDrafts(), ...drafts])");
    const addDraft = ctor.slice(
      ctor.indexOf("const addDraft = React.useCallback("),
      ctor.indexOf("// The sign check (see `registerDraftFlush`)"),
    );
    expect(addDraft).toContain("admitPendingPick(waiting, draft, noteId)");
    expect(addDraft).toContain("setRevealRow(opened);");
  });

  it("a quick-dose chip in the prompt adds through the same path, so its row is revealed", () => {
    const form = ctor.slice(ctor.indexOf("const pendingForm ="), ctor.indexOf("const customForm ="));
    expect(form).toContain("setPending(null);");
    expect(form).toContain("addDraft({ ...draft, dose }, forms);");
  });

  it("the constructor's sign check is still handed to the reception", () => {
    const panels = read("_components/structured-fields-panel.tsx");
    const middle = panels.slice(panels.indexOf("export function PrescriptionsPanel"));
    expect(middle).toContain("registerDraftFlush={registerDraftFlush}");
    expect(middle).toMatch(/aboveColumns=\{\(pickApi\) => \(\s*<DiagnosisMemoryCard/);
  });
});

describe("«Обычно при» and the double-click guard", () => {
  const card = read("_components/diagnosis-memory-card.tsx");

  it("a double click on «Добавить всё» or a chip adds once", () => {
    expect(card).toContain('import { isRepeatClick } from "../_hooks/prescription-columns";');
    const addAllButton = card.slice(card.indexOf("disabled={nothingLeft}"));
    expect(addAllButton.slice(0, 400)).toContain("if (isRepeatClick(e.detail)) return;");
    const chip = card.slice(card.indexOf("function ChipButton"));
    expect(chip).toContain("if (isRepeatClick(e.detail)) return;");
    expect(isRepeatClick(0)).toBe(false);
    expect(isRepeatClick(2)).toBe(true);
  });
});

describe("one «on the visit» rule for the picker and the memory", () => {
  it("a catalog row counts its text line, and the mark never blocks the picker", () => {
    const onVisit = onVisitChecker(
      [{ drugId: "ethylmethylhydroxypyridine", displayName: "Мексидол" }],
      [],
    );
    expect(onVisit({ drugId: "ethylmethylhydroxypyridine", label: "Мексидол" })).toBe(true);
    expect(onVisit({ drugId: null, label: "Мексидол 5,0 в/м №10" })).toBe(true);
    expect(onVisit({ drugId: null, label: "Магний B6 1 таб" })).toBe(false);
    const picker = read("_components/prescription-picker.tsx");
    expect(picker).not.toContain("disabled={added}");
    expect(picker).toContain("if (isRepeatClick(e.detail)) return;");
  });
});

describe("a template is written once, as whole lines, and can go again", () => {
  const template = "Рекомендовано: МРТ головного мозга.\nКонтроль через 14 дней.";

  it("a second apply, padded or not, leaves the body as it is", () => {
    const once = appendSnippet("Осмотр.", template);
    expect(appendSnippet(once, `  ${template}\n`)).toBe(once);
  });

  it("a template inside a sentence of his own text is still added", () => {
    expect(appendSnippet("Назначено: МРТ, ЭЭГ.", "МРТ")).toBe("Назначено: МРТ, ЭЭГ.\n\nМРТ");
  });

  it("the preview names it and its removal leaves the body clean", () => {
    const body = appendSnippet(appendSnippet("Осмотр.", template), template);
    expect(templatesInBody(body, [{ name: "Мигрень", text: template }])).toEqual([
      { name: "Мигрень", text: template },
    ]);
    expect(removeSnippet(body, `${template}\n`)).toBe("Осмотр.");
  });
});
