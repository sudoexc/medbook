import { describe, expect, it } from "vitest";

import {
  parseConclusionPrescriptions,
  unadoptedCandidates,
} from "@/lib/catalogs/conclusion-parse";

// The doctor's REAL conclusion text from the first live weeks (screenshot
// 21.09.2026) — the parser must handle this verbatim, it is the whole point.
const REAL_TEXT = `Ежедневные прогулки на свежем воздухе не менее 30–40 минут, желательно во второй половине дня.

Мидокалм (толперизон) 150 мг — по 1 таблетке 2–3 раза в день, курс 10 дней.

Афобазол 10 мг — по 1 таблетке 3 раза в день после еды, курс 1 месяц.

Цераксон (цитиколин) 1000 мг — по 1 пакетику 1 раз в день внутрь, курс 30 дней.

Грандаксин 50 мг — по 1 таблетке утром и днём, не вечером, курс 14 дней.

Магне В6 — по 2 таблетки 2 раза в день во время еды, курс 1 месяц.

Глицин 100 мг — рассасывать по 1 таблетке под язык 3 раза в день, курс 30 дней.

Мексидол 125 мг — по 1 таблетке 3 раза в день внутрь, курс 30 дней. Принимать после еды.

Рекомендовано проведение электроэнцефалографии (ЭЭГ) для оценки биоэлектрической активности головного мозга.

Кеторол 10 мг — при выраженной боли по 1 таблетке внутрь, не более 3 раз в день, не более 5 дней. Принимать после еды, запивать водой.`;

describe("parseConclusionPrescriptions", () => {
  it("extracts all eight drugs from the doctor's real text and nothing else", () => {
    const rows = parseConclusionPrescriptions(REAL_TEXT);
    expect(rows.map((r) => r.displayName)).toEqual([
      "Мидокалм (толперизон)",
      "Афобазол",
      "Цераксон (цитиколин)",
      "Грандаксин",
      "Магне В6",
      "Глицин",
      "Мексидол",
      "Кеторол",
    ]);
  });

  it("parses strength off the name", () => {
    const rows = parseConclusionPrescriptions(REAL_TEXT);
    const byName = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(byName["Мидокалм (толперизон)"]!.strength).toBe("150 мг");
    expect(byName["Цераксон (цитиколин)"]!.strength).toBe("1000 мг");
    expect(byName["Магне В6"]!.strength).toBeNull();
  });

  it("parses course duration in days, weeks and months", () => {
    const rows = parseConclusionPrescriptions(REAL_TEXT);
    const byName = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(byName["Мидокалм (толперизон)"]!.durationDays).toBe(10);
    expect(byName["Афобазол"]!.durationDays).toBe(30);
    expect(byName["Грандаксин"]!.durationDays).toBe(14);
    const weekly = parseConclusionPrescriptions(
      "Нейромидин 20 мг — по 1 таблетке 2 раза в день, курсом 2 недели.",
    );
    expect(weekly[0]!.durationDays).toBe(14);
  });

  it("parses meal relation", () => {
    const rows = parseConclusionPrescriptions(REAL_TEXT);
    const byName = Object.fromEntries(rows.map((r) => [r.displayName, r]));
    expect(byName["Афобазол"]!.mealRelation).toBe("AFTER_MEAL");
    expect(byName["Магне В6"]!.mealRelation).toBe("WITH_MEAL");
    expect(byName["Мидокалм (толперизон)"]!.mealRelation).toBe("NO_MATTER");
  });

  it("keeps the instruction tail without the course clause", () => {
    const rows = parseConclusionPrescriptions(
      "Мидокалм 150 мг — по 1 таблетке 2–3 раза в день, курс 10 дней.",
    );
    expect(rows[0]!.instruction).toBe("по 1 таблетке 2–3 раза в день");
  });

  it("skips referrals, lifestyle advice and investigations", () => {
    const rows = parseConclusionPrescriptions(
      [
        "Рекомендовано проведение МРТ головного мозга.",
        "Ежедневные прогулки на свежем воздухе не менее 30–40 минут.",
        "ЭЭГ — для оценки активности головного мозга.",
        "Контроль через 2 недели.",
        "Консультация кардиолога — при болях в сердце.",
        "Режим сна — не менее 8 часов.",
      ].join("\n"),
    );
    expect(rows).toEqual([]);
  });

  it("requires a schedule-shaped tail even when a dose is present", () => {
    const rows = parseConclusionPrescriptions(
      "Гемоглобин 120 г — в пределах нормы.",
    );
    expect(rows).toEqual([]);
  });

  it("dedups repeated drug mentions within one text", () => {
    const rows = parseConclusionPrescriptions(
      "Глицин 100 мг — по 1 таблетке 3 раза в день.\nГлицин — рассасывать по 1 таблетке на ночь.",
    );
    expect(rows).toHaveLength(1);
  });

  it("handles colon and short-dash separators", () => {
    const rows = parseConclusionPrescriptions(
      "Мильгамма: по 1 таблетке 1 раз в день, курс 30 дней.\nВинпоцетин 10 мг - по 1 таблетке 3 раза в день.",
    );
    expect(rows.map((r) => r.displayName)).toEqual([
      "Мильгамма",
      "Винпоцетин",
    ]);
  });

  it("never turns section headers into medications (review attack set)", () => {
    const rows = parseConclusionPrescriptions(
      [
        "Жалобы: головные боли, усиливающиеся утром, головокружение.",
        "Анамнез: принимает Конкор по 1 таблетке утром в течение года.",
        "Объективно: сознание ясное, зрачки D=S.",
        "Диагноз: G43.0 Мигрень без ауры.",
      ].join("\n"),
    );
    expect(rows).toEqual([]);
  });

  it("strips «Лечение:» header and still finds the drug behind it", () => {
    const rows = parseConclusionPrescriptions(
      "Лечение: Мидокалм 150 мг по 1 таблетке 2 раза в день, курс 10 дней.",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Мидокалм");
    expect(rows[0]!.strength).toBe("150 мг");
  });

  it("parses PRN style: condition first, drug after the dash", () => {
    const rows = parseConclusionPrescriptions(
      "При головной боли — Нурофен по 1 таблетке, не более 3 раз в день.",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Нурофен");
    expect(rows[0]!.instruction).toContain("при головной боли");
  });

  it("rejects dash-led lifestyle lines (review attack set)", () => {
    const rows = parseConclusionPrescriptions(
      [
        "Вечером — тёплая ванна с морской солью перед сном.",
        "Измерять АД — утром и вечером, записывать показания.",
        "Пить больше воды — не менее 2 литров в день, утром натощак стакан воды.",
      ].join("\n"),
    );
    expect(rows).toEqual([]);
  });

  it("parses a dash-less dose-anchored line", () => {
    const rows = parseConclusionPrescriptions(
      "Мексидол 125 мг по 1 таблетке 3 раза в день, курс 30 дней.",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Мексидол");
  });

  it("clamps absurd course lengths to the server max of 365 days", () => {
    const rows = parseConclusionPrescriptions(
      "Депакин хроно 500 мг — по 1 таблетке 2 раза в день, курс 18 месяцев.",
    );
    expect(rows[0]!.durationDays).toBe(365);
  });

  it("keeps a dosed drug whose tail only names times of day", () => {
    const rows = parseConclusionPrescriptions(
      "Депакин хроно 500 мг — утром и вечером.",
    );
    expect(rows).toHaveLength(1);
  });

  it("returns empty for empty or null input", () => {
    expect(parseConclusionPrescriptions(null)).toEqual([]);
    expect(parseConclusionPrescriptions("")).toEqual([]);
  });
});

describe("unadoptedCandidates", () => {
  const parsed = parseConclusionPrescriptions(REAL_TEXT);

  it("filters out drugs already present in structured rows", () => {
    const rest = unadoptedCandidates(parsed, ["Мидокалм 150 мг", "Глицин"]);
    expect(rest.map((r) => r.displayName)).not.toContain(
      "Мидокалм (толперизон)",
    );
    expect(rest.map((r) => r.displayName)).not.toContain("Глицин");
    expect(rest).toHaveLength(6);
  });

  it("keeps everything when nothing is adopted yet", () => {
    expect(unadoptedCandidates(parsed, [])).toHaveLength(8);
  });

  it("does not let «Магнерот» suppress «Магне В6» (whole-word match)", () => {
    const magne = parseConclusionPrescriptions(
      "Магне В6 — по 2 таблетки 2 раза в день во время еды.",
    );
    expect(unadoptedCandidates(magne, ["Магнерот 500 мг"])).toHaveLength(1);
  });
});
