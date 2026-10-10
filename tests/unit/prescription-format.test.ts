/**
 * Ф2 (TZ-smart-constructor) — pins the shared prescription line formats:
 * the compact formatPrescriptionLine (the doctor's lists and checks) and the
 * patient's formatPatientLine in words (print, handout, the visit screen).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatPatientLine,
  formatPatientSchedule,
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

// Doctor's request 10.10.2026: the intake grid «Утро | День | Вечер | Ночь»
// was hard to read; the patient gets the schedule in words, and a tablet's
// count («1 таб.») can stand for the dose while its strength stays in the name.
describe("formatPatientLine: the schedule in words", () => {
  const carb = (over: Partial<PrescriptionLikeRow> = {}) =>
    row({
      displayName: "Карбамазепин",
      strength: "200 мг",
      dose: "1 таб.",
      timesOfDay: ["EVENING", "MORNING"],
      mealRelation: "AFTER_MEAL",
      durationDays: 10,
      ...over,
    });

  it("count, how many times a day, when with the meal, the course", () => {
    expect(formatPatientLine(carb(), "ru")).toBe(
      "Карбамазепин 200 мг — по 1 таблетке 2 раза в день: утром после еды и вечером после еды, курс 10 дней",
    );
  });

  it("three or four times: the meal once, «каждый раз»", () => {
    expect(formatPatientSchedule(carb({ timesOfDay: ["MORNING", "NOON", "EVENING", "NIGHT"] }), "ru")).toBe(
      "по 1 таблетке 4 раза в день: утром, днём, вечером и на ночь, каждый раз после еды, курс 10 дней",
    );
  });

  it("every counted unit in its case, either language's spelling", () => {
    const amount = (dose: string) =>
      formatPatientSchedule(carb({ dose, timesOfDay: [], mealRelation: "NO_MATTER", durationDays: null }), "ru");
    expect(amount("1 капля")).toBe("по 1 капле");
    expect(amount("21 капля")).toBe("по 21 капле");
    expect(amount("2 капли")).toBe("по 2 капли");
    expect(amount("10 капель")).toBe("по 10 капель");
    expect(amount("1 свеча")).toBe("по 1 свече");
    expect(amount("1 амп.")).toBe("по 1 ампуле");
    expect(amount("1 впрыск")).toBe("по 1 впрыску");
    expect(amount("1 пакетик")).toBe("по 1 пакетику");
    expect(amount("1 вдох")).toBe("по 1 вдоху");
    expect(amount("1 пластырь")).toBe("по 1 пластырю");
    expect(amount("1 доза")).toBe("по 1 дозе");
    expect(amount("1 tabletka")).toBe("по 1 таблетке");
    expect(amount("1-2 таб.")).toBe("по 1-2 таблетки");
    expect(amount("5-6 таб.")).toBe("по 5-6 таблеток");
    expect(amount("400 мг")).toBe("по 400 мг");
    expect(amount("5 ЕД")).toBe("по 5 ЕД");
    expect(amount("2 мл")).toBe("по 2 мл");
    // A word it cannot decline after a count ending in 1 goes without «по».
    expect(amount("1 чайная ложка")).toBe("1 чайная ложка");
    expect(amount("по 1 таб.")).toBe("по 1 таб.");
  });

  it("a bare number is kept apart from «2 раза»", () => {
    expect(formatPatientSchedule(carb({ dose: "1", durationDays: null }), "ru")).toBe(
      "по 1, 2 раза в день: утром после еды и вечером после еды",
    );
  });

  it("declines the count and the days", () => {
    expect(formatPatientSchedule(carb({ dose: "2 таб." }), "ru")).toMatch(/^по 2 таблетки /);
    expect(formatPatientSchedule(carb({ dose: "5 таб." }), "ru")).toMatch(/^по 5 таблеток /);
    expect(formatPatientSchedule(carb({ dose: "½ таб." }), "ru")).toMatch(/^по ½ таблетки /);
    expect(formatPatientSchedule(carb({ dose: "1 капс." }), "ru")).toMatch(/^по 1 капсуле /);
    expect(formatPatientSchedule(carb({ durationDays: 21 }), "ru")).toMatch(/курс 21 день$/);
    expect(formatPatientSchedule(carb({ durationDays: 3 }), "ru")).toMatch(/курс 3 дня$/);
    expect(formatPatientSchedule(carb({ durationDays: 11 }), "ru")).toMatch(/курс 11 дней$/);
  });

  it("one time a day is just the time; a strength as the dose leaves the name bare", () => {
    expect(formatPatientLine(carb({ timesOfDay: ["NIGHT"], mealRelation: "NO_MATTER" }), "ru")).toBe(
      "Карбамазепин 200 мг — по 1 таблетке на ночь, курс 10 дней",
    );
    expect(formatPatientLine(carb({ dose: "200 мг" }), "ru")).toBe(
      "Карбамазепин — по 200 мг 2 раза в день: утром после еды и вечером после еды, курс 10 дней",
    );
  });

  it("words stay as written, nothing at all leaves the name", () => {
    expect(formatPatientSchedule(carb({ dose: "тонким слоем", timesOfDay: [], durationDays: null, mealRelation: "NO_MATTER" }), "ru")).toBe(
      "тонким слоем",
    );
    expect(
      formatPatientLine(carb({ dose: "", timesOfDay: [], durationDays: null, strength: null, mealRelation: "NO_MATTER" }), "ru"),
    ).toBe("Карбамазепин");
  });

  it("Uzbek: kuniga N marta, kun davomida; a Russian count in Uzbek words", () => {
    expect(formatPatientLine(carb({ dose: "1 tabletka" }), "uz")).toBe(
      "Карбамазепин 200 мг — 1 tabletka, kuniga 2 marta: ertalab ovqatdan keyin va kechqurun ovqatdan keyin, 10 kun davomida",
    );
    expect(formatPatientSchedule(carb({ dose: "2 таб.", timesOfDay: [], mealRelation: "NO_MATTER", durationDays: null }), "uz")).toBe(
      "2 tabletka",
    );
  });

  it("the instruction starts a sentence", () => {
    expect(
      formatPatientLine(carb({ instructionRu: "не разжёвывать" }), "ru", { withInstruction: true }),
    ).toMatch(/курс 10 дней\. Не разжёвывать$/);
  });

  it("no dashes inside the schedule, only the one after the name", () => {
    for (const r of [carb(), carb({ dose: "2 таб.", timesOfDay: ["MORNING", "NOON", "EVENING", "NIGHT"] })]) {
      expect(formatPatientSchedule(r, "ru")).not.toMatch(/[—–]/);
    }
  });
});

describe("the grid is gone from every print", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("print route, handout, bot PDF and the visit screen speak in words", () => {
    const route = read("src/app/api/crm/visit-notes/[id]/print/route.ts");
    expect(route).not.toMatch(/med-grid|MedicationGrid|gridTitle/);
    expect(route).toContain("...formatPatientLines(note.visitPrescriptions, locale, {");
    expect(read("src/server/visit-notes/handout.ts")).toContain(
      "...formatPatientLines(fields.visitPrescriptions ?? [], locale, {",
    );
    expect(read("src/server/visit-notes/conclusion-pdf.ts")).not.toMatch(/buildMedicationGrid|drawGridRow/);
    expect(read("src/server/visit-notes/render-handout.ts")).not.toContain("MedicationGrid");
    expect(read("src/app/[locale]/doctor/reception/_components/prescription-constructor.tsx")).toContain(
      "const line = formatPatientLine(row, locale, { withInstruction: true });",
    );
  });
});
