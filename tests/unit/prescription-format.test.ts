/**
 * Ф2 (TZ-smart-constructor) — pins the shared prescription line format.
 * Constructor preview, print route and handout composer all render through
 * formatPrescriptionLine; these tests freeze the contract.
 */
import { describe, expect, it } from "vitest";

import {
  formatPrescriptionLine,
  formatPrescriptionLines,
  type PrescriptionLikeRow,
} from "@/lib/catalogs/prescription-format";

function row(over: Partial<PrescriptionLikeRow> = {}): PrescriptionLikeRow {
  return {
    displayName: "Бисопролол",
    strength: "5 мг",
    dose: "1 таб",
    timesOfDay: ["MORNING"],
    mealRelation: "NO_MATTER",
    durationDays: 30,
    instructionRu: null,
    instructionUz: null,
    ...over,
  };
}

describe("formatPrescriptionLine (ru)", () => {
  it("renders head with strength + full schedule", () => {
    expect(formatPrescriptionLine(row(), "ru")).toBe(
      "Бисопролол 5 мг — 1 таб, утром, 30 дн.",
    );
  });

  it("skips strength when dose equals it", () => {
    expect(formatPrescriptionLine(row({ dose: "5 мг" }), "ru")).toBe(
      "Бисопролол — 5 мг, утром, 30 дн.",
    );
  });

  it("skips strength when displayName already contains it", () => {
    expect(
      formatPrescriptionLine(row({ displayName: "Конкор 5 мг" }), "ru"),
    ).toBe("Конкор 5 мг — 1 таб, утром, 30 дн.");
  });

  it("joins two times with «и» and orders by day, not click order", () => {
    expect(
      formatPrescriptionLine(
        row({ timesOfDay: ["EVENING", "MORNING"] }),
        "ru",
      ),
    ).toBe("Бисопролол 5 мг — 1 таб, утром и вечером, 30 дн.");
  });

  it("joins three+ times with commas and «и» before the last", () => {
    expect(
      formatPrescriptionLine(
        row({ timesOfDay: ["MORNING", "NOON", "EVENING", "NIGHT"] }),
        "ru",
      ),
    ).toBe(
      "Бисопролол 5 мг — 1 таб, утром, днём, вечером и на ночь, 30 дн.",
    );
  });

  it("renders meal relation, omits it for NO_MATTER", () => {
    expect(
      formatPrescriptionLine(row({ mealRelation: "AFTER_MEAL" }), "ru"),
    ).toBe("Бисопролол 5 мг — 1 таб, утром, после еды, 30 дн.");
    expect(formatPrescriptionLine(row(), "ru")).not.toContain("еды");
  });

  it("omits duration when null", () => {
    expect(formatPrescriptionLine(row({ durationDays: null }), "ru")).toBe(
      "Бисопролол 5 мг — 1 таб, утром",
    );
  });

  it("returns bare head when there is no schedule at all", () => {
    expect(
      formatPrescriptionLine(
        row({ dose: "", timesOfDay: [], durationDays: null, strength: null }),
        "ru",
      ),
    ).toBe("Бисопролол");
  });

  it("appends instruction after a period with withInstruction", () => {
    expect(
      formatPrescriptionLine(
        row({ instructionRu: "Не разжёвывать" }),
        "ru",
        { withInstruction: true },
      ),
    ).toBe("Бисопролол 5 мг — 1 таб, утром, 30 дн. Не разжёвывать");
  });

  it("ignores instruction without the flag", () => {
    expect(
      formatPrescriptionLine(row({ instructionRu: "Не разжёвывать" }), "ru"),
    ).toBe("Бисопролол 5 мг — 1 таб, утром, 30 дн.");
  });
});

describe("formatPrescriptionLine (uz)", () => {
  it("renders uz time labels, «va» join and kun suffix", () => {
    expect(
      formatPrescriptionLine(
        row({ timesOfDay: ["MORNING", "NIGHT"], mealRelation: "BEFORE_MEAL" }),
        "uz",
      ),
    ).toBe(
      "Бисопролол 5 мг — 1 таб, ertalab va uxlashdan oldin, ovqatdan oldin, 30 kun",
    );
  });

  it("prefers instructionUz, falls back to instructionRu", () => {
    expect(
      formatPrescriptionLine(
        row({ instructionRu: "Не разжёвывать", instructionUz: "Chaynamang" }),
        "uz",
        { withInstruction: true },
      ),
    ).toContain(". Chaynamang");
    expect(
      formatPrescriptionLine(
        row({ instructionRu: "Не разжёвывать", instructionUz: null }),
        "uz",
        { withInstruction: true },
      ),
    ).toContain(". Не разжёвывать");
  });
});

describe("formatPrescriptionLines", () => {
  it("maps rows preserving order and options", () => {
    expect(
      formatPrescriptionLines(
        [row(), row({ displayName: "Амоксициллин", strength: null })],
        "ru",
      ),
    ).toEqual([
      "Бисопролол 5 мг — 1 таб, утром, 30 дн.",
      "Амоксициллин — 1 таб, утром, 30 дн.",
    ]);
  });
});
