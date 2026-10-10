/**
 * Audit VW-20 — the constructor edits only the instruction of the doctor's
 * interface language, so «ovqatdan keyin, 1 oy» typed on the Uzbek screen
 * lives in instructionUz alone. The Russian print line and the handout
 * read instructionRu only, and the doctor's instruction vanished from the
 * Russian-speaking patient's paper.
 *
 * Pinned: each language falls back on the other; its own text still wins.
 * Both the doctor's compact line and the patient's line in words (which
 * replaced the intake grid, doctor's request 10.10.2026) do it.
 */
import { describe, expect, it } from "vitest";

import {
  formatPatientLine,
  formatPrescriptionLine,
} from "@/lib/catalogs/prescription-format";

const row = (instructionRu: string | null, instructionUz: string | null) => ({
  displayName: "Мидокалм",
  strength: "150 мг",
  dose: "1 таб",
  timesOfDay: ["MORNING", "EVENING"],
  mealRelation: "AFTER_MEAL",
  durationDays: 10,
  instructionRu,
  instructionUz,
});

const withInstruction = { withInstruction: true };

describe("the instruction reaches the print in either language", () => {
  it("ru print shows an instruction typed only in Uzbek", () => {
    for (const f of [formatPrescriptionLine, formatPatientLine]) {
      expect(f(row(null, "ovqatdan keyin, 1 oy"), "ru", withInstruction)).toContain(
        "ovqatdan keyin, 1 oy",
      );
    }
  });

  it("uz print still falls back on Russian", () => {
    expect(formatPatientLine(row("после еды", null), "uz", withInstruction)).toMatch(
      /\. после еды$/,
    );
  });

  it("the language's own instruction wins over the other", () => {
    for (const f of [formatPrescriptionLine, formatPatientLine]) {
      const line = f(row("Не разжёвывать", "Chaynamang"), "ru", withInstruction);
      expect(line).toContain("Не разжёвывать");
      expect(line).not.toContain("Chaynamang");
    }
  });

  it("a blank instruction falls through to the other language", () => {
    expect(formatPatientLine(row("   ", "Chaynamang"), "ru", withInstruction)).toMatch(
      /\. Chaynamang$/,
    );
  });
});
