/**
 * Audit VW-20 — the constructor edits only the instruction of the doctor's
 * interface language, so «ovqatdan keyin, 1 oy» typed on the Uzbek screen
 * lives in instructionUz alone. The Russian print line and the handout grid
 * read instructionRu only, and the doctor's instruction vanished from the
 * Russian-speaking patient's paper.
 *
 * Pinned: each language falls back on the other; its own text still wins.
 */
import { describe, expect, it } from "vitest";

import { formatPrescriptionLine } from "@/lib/catalogs/prescription-format";
import { buildMedicationGrid } from "@/server/visit-notes/render-handout";

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

describe("the instruction reaches the print in either language", () => {
  it("ru print shows an instruction typed only in Uzbek", () => {
    const line = formatPrescriptionLine(row(null, "ovqatdan keyin, 1 oy"), "ru", {
      withInstruction: true,
    });
    expect(line).toContain("ovqatdan keyin, 1 oy");
    const grid = buildMedicationGrid([row(null, "ovqatdan keyin, 1 oy")], "ru");
    expect(grid.rows[0]!.note).toBe("ovqatdan keyin, 1 oy");
  });

  it("uz print still falls back on Russian", () => {
    const grid = buildMedicationGrid([row("после еды", null)], "uz");
    expect(grid.rows[0]!.note).toBe("после еды");
  });

  it("the language's own instruction wins over the other", () => {
    const line = formatPrescriptionLine(row("после еды", "ovqatdan keyin"), "ru", {
      withInstruction: true,
    });
    expect(line).toContain("после еды");
    expect(line).not.toContain("ovqatdan keyin");
    const grid = buildMedicationGrid([row("после еды", "ovqatdan keyin")], "ru");
    expect(grid.rows[0]!.note).toBe("после еды");
  });

  it("a blank instruction falls through to the other language", () => {
    const grid = buildMedicationGrid([row("   ", "ovqatdan keyin")], "ru");
    expect(grid.rows[0]!.note).toBe("ovqatdan keyin");
  });
});
