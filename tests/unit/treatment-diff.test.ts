/**
 * Ф7 — детерминированный дифф лечения (prev visitPrescriptions → next).
 *
 * Самая ценная строка документа для хроника — обязана быть воспроизводимой:
 * matching по drugId, потом по нормализованному имени; порядок entries
 * фиксирован (изменения → отменено → добавлено); направление дозы парсится
 * из первого числа. Тестируется без БД.
 */
import { describe, expect, it } from "vitest";

import {
  diffTreatments,
  formatTreatmentDiff,
  formatTreatmentDiffLine,
  type TreatmentDiffRow,
} from "@/lib/catalogs/treatment-diff";

function row(partial: Partial<TreatmentDiffRow> & { displayName: string }): TreatmentDiffRow {
  return {
    drugId: null,
    strength: null,
    dose: "1 таб",
    timesOfDay: ["MORNING"],
    mealRelation: "AFTER_MEAL",
    durationDays: 10,
    ...partial,
  };
}

describe("diffTreatments", () => {
  it("returns [] when nothing changed", () => {
    const a = [row({ displayName: "Конкор", strength: "5 мг" })];
    const b = [row({ displayName: "Конкор", strength: "5 мг" })];
    expect(diffTreatments(a, b)).toEqual([]);
  });

  it("detects added and removed by name", () => {
    const prev = [row({ displayName: "Аспирин" })];
    const next = [row({ displayName: "Но-шпа" })];
    expect(diffTreatments(prev, next)).toEqual([
      { kind: "REMOVED", name: "Аспирин" },
      { kind: "ADDED", name: "Но-шпа" },
    ]);
  });

  it("matches by name case/space-insensitively", () => {
    const prev = [row({ displayName: "  конкор " })];
    const next = [row({ displayName: "Конкор" })];
    expect(diffTreatments(prev, next)).toEqual([]);
  });

  it("prefers drugId match over display name", () => {
    // Renamed in the catalog but same drugId → same drug, no add/remove noise.
    const prev = [row({ drugId: "d1", displayName: "Бисопролол" })];
    const next = [row({ drugId: "d1", displayName: "Конкор" })];
    expect(diffTreatments(prev, next)).toEqual([]);
  });

  it("reports dose UP with strength from→to (TZ: ↑ доза 5→10 мг)", () => {
    const prev = [row({ displayName: "Конкор", strength: "5 мг" })];
    const next = [row({ displayName: "Конкор", strength: "10 мг" })];
    expect(diffTreatments(prev, next)).toEqual([
      {
        kind: "DOSE_CHANGED",
        name: "Конкор",
        from: "5 мг",
        to: "10 мг",
        direction: "UP",
      },
    ]);
  });

  it("reports dose DOWN", () => {
    const prev = [row({ displayName: "Конкор", strength: "10 мг" })];
    const next = [row({ displayName: "Конкор", strength: "5 мг" })];
    const out = diffTreatments(prev, next);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "DOSE_CHANGED", direction: "DOWN" });
  });

  it("dose change without parseable numbers → direction NONE", () => {
    const prev = [row({ displayName: "Магне", dose: "одна таблетка" })];
    const next = [row({ displayName: "Магне", dose: "две таблетки" })];
    const out = diffTreatments(prev, next);
    expect(out).toEqual([
      {
        kind: "DOSE_CHANGED",
        name: "Магне",
        from: "одна таблетка",
        to: "две таблетки",
        direction: "NONE",
      },
    ]);
  });

  it("dose field change uses dose values when strength unchanged", () => {
    const prev = [row({ displayName: "Конкор", strength: "5 мг", dose: "1 таб" })];
    const next = [row({ displayName: "Конкор", strength: "5 мг", dose: "2 таб" })];
    expect(diffTreatments(prev, next)).toEqual([
      {
        kind: "DOSE_CHANGED",
        name: "Конкор",
        from: "1 таб",
        to: "2 таб",
        direction: "UP",
      },
    ]);
  });

  it("detects schedule change: timesOfDay set", () => {
    const prev = [row({ displayName: "Конкор", timesOfDay: ["MORNING"] })];
    const next = [
      row({ displayName: "Конкор", timesOfDay: ["MORNING", "EVENING"] }),
    ];
    expect(diffTreatments(prev, next)).toEqual([
      { kind: "SCHEDULE_CHANGED", name: "Конкор" },
    ]);
  });

  it("timesOfDay order does not matter", () => {
    const prev = [
      row({ displayName: "Конкор", timesOfDay: ["MORNING", "EVENING"] }),
    ];
    const next = [
      row({ displayName: "Конкор", timesOfDay: ["EVENING", "MORNING"] }),
    ];
    expect(diffTreatments(prev, next)).toEqual([]);
  });

  it("detects schedule change: mealRelation / durationDays", () => {
    const prev = [
      row({ displayName: "А", mealRelation: "AFTER_MEAL", durationDays: 10 }),
    ];
    expect(
      diffTreatments(prev, [
        row({ displayName: "А", mealRelation: "BEFORE_MEAL", durationDays: 10 }),
      ]),
    ).toEqual([{ kind: "SCHEDULE_CHANGED", name: "А" }]);
    expect(
      diffTreatments(prev, [
        row({ displayName: "А", mealRelation: "AFTER_MEAL", durationDays: 14 }),
      ]),
    ).toEqual([{ kind: "SCHEDULE_CHANGED", name: "А" }]);
  });

  it("dose change wins over simultaneous schedule change", () => {
    const prev = [row({ displayName: "Конкор", strength: "5 мг", timesOfDay: ["MORNING"] })];
    const next = [
      row({
        displayName: "Конкор",
        strength: "10 мг",
        timesOfDay: ["MORNING", "EVENING"],
      }),
    ];
    const out = diffTreatments(prev, next);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("DOSE_CHANGED");
  });

  it("orders entries changed → removed → added", () => {
    const prev = [
      row({ displayName: "Конкор", strength: "5 мг" }),
      row({ displayName: "Аспирин" }),
    ];
    const next = [
      row({ displayName: "Но-шпа" }),
      row({ displayName: "Конкор", strength: "10 мг" }),
    ];
    expect(diffTreatments(prev, next).map((e) => e.kind)).toEqual([
      "DOSE_CHANGED",
      "REMOVED",
      "ADDED",
    ]);
  });

  it("consumes duplicate prev rows at most once", () => {
    const prev = [
      row({ displayName: "Конкор", strength: "5 мг" }),
      row({ displayName: "Конкор", strength: "5 мг" }),
    ];
    const next = [row({ displayName: "Конкор", strength: "5 мг" })];
    expect(diffTreatments(prev, next)).toEqual([
      { kind: "REMOVED", name: "Конкор" },
    ]);
  });
});

describe("formatTreatmentDiffLine", () => {
  it("formats RU lines exactly", () => {
    expect(formatTreatmentDiffLine({ kind: "ADDED", name: "Но-шпа" }, "ru")).toBe(
      "добавлено: Но-шпа",
    );
    expect(
      formatTreatmentDiffLine({ kind: "REMOVED", name: "Аспирин" }, "ru"),
    ).toBe("отменено: Аспирин");
    expect(
      formatTreatmentDiffLine(
        {
          kind: "DOSE_CHANGED",
          name: "Конкор",
          from: "5 мг",
          to: "10 мг",
          direction: "UP",
        },
        "ru",
      ),
    ).toBe("↑ доза Конкор: 5 мг → 10 мг");
    expect(
      formatTreatmentDiffLine(
        {
          kind: "DOSE_CHANGED",
          name: "Конкор",
          from: "10 мг",
          to: "5 мг",
          direction: "DOWN",
        },
        "ru",
      ),
    ).toBe("↓ доза Конкор: 10 мг → 5 мг");
    expect(
      formatTreatmentDiffLine(
        {
          kind: "DOSE_CHANGED",
          name: "Магне",
          from: "одна",
          to: "две",
          direction: "NONE",
        },
        "ru",
      ),
    ).toBe("доза Магне: одна → две");
    expect(
      formatTreatmentDiffLine({ kind: "SCHEDULE_CHANGED", name: "Конкор" }, "ru"),
    ).toBe("изменена схема приёма: Конкор");
  });

  it("formats UZ lines", () => {
    expect(formatTreatmentDiffLine({ kind: "ADDED", name: "No-shpa" }, "uz")).toBe(
      "qo‘shildi: No-shpa",
    );
    expect(
      formatTreatmentDiffLine(
        {
          kind: "DOSE_CHANGED",
          name: "Konkor",
          from: "5 mg",
          to: "10 mg",
          direction: "UP",
        },
        "uz",
      ),
    ).toBe("↑ Konkor dozasi: 5 mg → 10 mg");
  });
});

describe("formatTreatmentDiff", () => {
  it("maps the full diff to printable lines", () => {
    const prev = [
      row({ displayName: "Конкор", strength: "5 мг" }),
      row({ displayName: "Аспирин" }),
    ];
    const next = [
      row({ displayName: "Конкор", strength: "10 мг" }),
      row({ displayName: "Но-шпа" }),
    ];
    expect(formatTreatmentDiff(diffTreatments(prev, next), "ru")).toEqual([
      "↑ доза Конкор: 5 мг → 10 мг",
      "отменено: Аспирин",
      "добавлено: Но-шпа",
    ]);
  });
});
