/**
 * Audit VW-12 — the protocol dialog previewed complaints, anamnesis,
 * examination and recommended labs; «Применить» applied none of them. The
 * labs hint said «будут привязаны к лабораторному модулю в G3», a phase of
 * development, in ru and uz. The doctor's settings still let him write
 * complaint, anamnesis and examination templates the visit never shows.
 *
 * Pinned at the source, since the dialog renders in a portal: every field
 * the dialog previews is one the apply handler writes, none of the dropped
 * ones is previewed, no «G3» is left in either language, and the settings
 * offer only the fields the visit screen has.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const DIALOG = read("src/app/[locale]/doctor/reception/_components/apply-protocol-dialog.tsx");
const PANEL = read("src/app/[locale]/doctor/reception/_components/structured-fields-panel.tsx");
const PRESETS = read("src/app/[locale]/doctor/settings/_components/presets-tab.tsx");

/** The `protocol.<field>` reads of a source, doc comments left out. */
function protocolFields(src: string): Set<string> {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return new Set([...code.matchAll(/protocol\.(\w+)/g)].map((m) => m[1]!));
}

describe("the protocol dialog previews only what is applied", () => {
  it("drops the fields nothing applies", () => {
    const shown = protocolFields(DIALOG);
    for (const f of [
      "complaintsTemplate",
      "anamnesisTemplate",
      "examinationTemplate",
      "recommendedLabs",
    ]) {
      expect(shown.has(f), f).toBe(false);
    }
  });

  it("every clinical field it previews is one the apply handler writes", () => {
    const applied = protocolFields(PANEL);
    const labels = new Set(["nameRu", "summaryRu", "diagnosisCodePrefix", "doctorId", "clinicId"]);
    for (const f of protocolFields(DIALOG)) {
      if (labels.has(f)) continue;
      expect(applied.has(f), f).toBe(true);
    }
  });

  it("hides the control visit when the doctor already set one", () => {
    expect(DIALOG).toMatch(/protocol\.followUpDays && !followUpSet/);
    expect(PANEL).toMatch(/followUpSet=\{/);
  });
});

describe("no development phase in the doctor's texts", () => {
  it.each(["ru", "uz"])("%s: the apply dialog says what it does, without «G3»", (lang) => {
    const messages = JSON.parse(read(`src/messages/${lang}.json`)) as {
      doctor: { receptionDialogs: { applyProtocol: Record<string, unknown> } };
    };
    const block = messages.doctor.receptionDialogs.applyProtocol;
    expect(JSON.stringify(block)).not.toMatch(/G3/);
    expect(block.labsHint).toBeUndefined();
    expect(String(block.fallbackSummary)).not.toMatch(/[—–]/);
  });
});

describe("the doctor's templates", () => {
  it("offer only the fields the visit screen shows", () => {
    const fields = PRESETS.slice(PRESETS.indexOf("const FIELDS"), PRESETS.indexOf("];"));
    expect(fields).toContain('"PRESCRIPTIONS"');
    expect(fields).toContain('"ADVICE"');
    for (const dead of ["COMPLAINTS", "ANAMNESIS", "EXAMINATION"]) {
      expect(fields).not.toContain(`"${dead}"`);
    }
  });
});
