/**
 * Phase 15 Wave 1 — `src/server/ai/redact.ts` unit tests.
 *
 * The redaction layer is security-critical: every LLM call routes through
 * it before the prompt leaves the building. The corpus below covers UZ /
 * international phone formats, name lists, passport / JSHSHIR ids, and
 * email — plus negative tests for medical numerics that must NOT be
 * redacted.
 */

import { describe, it, expect } from "vitest";

import {
  redact,
  redactWithKnownNames,
  unredact,
  type RedactionResult,
} from "@/server/ai/redact";

describe("redact — phones", () => {
  const cases: Array<{ label: string; input: string }> = [
    { label: "+998901234567", input: "Звонил пациент с +998901234567 утром." },
    { label: "+998 90 123 45 67", input: "Контакт: +998 90 123 45 67." },
    { label: "+998-90-123-45-67", input: "Перезвоните: +998-90-123-45-67." },
    { label: "+1-555-0123", input: "Visit log: +1-555-0123 noted." },
    { label: "(90) 123-45-67", input: "Доп номер (90) 123-45-67 для уточнения." },
    { label: "90.123.45.67", input: "Запись через 90.123.45.67 — утренний слот." },
    { label: "tel:+998901234567", input: "Кликни tel:+998901234567 чтобы связаться." },
  ];

  for (const tc of cases) {
    it(`redacts ${tc.label}`, () => {
      const r = redact(tc.input);
      expect(r.redacted).not.toContain(tc.label.replace("tel:", ""));
      expect(r.replacements.some((x) => x.kind === "PHONE")).toBe(true);
      expect(r.redacted).toMatch(/<PHONE_\d+>/);
    });
  }
});

describe("redactWithKnownNames", () => {
  it("redacts every occurrence of provided names case-insensitively", () => {
    const input = "Алишер Каримов сказал доктору Сафарову, что Сафаров перезвонит позже.";
    const r = redactWithKnownNames(input, ["Алишер Каримов", "Сафаров"]);
    expect(r.redacted).not.toContain("Алишер Каримов");
    expect(r.redacted).not.toContain("Сафаров");
    expect(r.redacted).toContain("<NAME_1>");
    expect(r.redacted).toContain("<NAME_2>");
    // Same name dedupes — no <NAME_3> for the second "Сафаров".
    expect(r.redacted).not.toContain("<NAME_3>");
  });

  it("prefers longer-matching name when one is a prefix of another", () => {
    const input = "Алишер Каримов и Каримов снова в клинике.";
    const r = redactWithKnownNames(input, ["Алишер Каримов", "Каримов"]);
    // First occurrence should match the longer "Алишер Каримов".
    expect(r.redacted.startsWith("<NAME_1>")).toBe(true);
    // Standalone "Каримов" should still be redacted.
    expect(r.redacted).not.toMatch(/Каримов/);
  });

  it("empty knownNames behaves like plain redact for names", () => {
    const input = "Сафаров записан на 15:00.";
    const r = redactWithKnownNames(input, []);
    expect(r.redacted).toBe(input); // no PII at all
    expect(r.replacements).toHaveLength(0);
  });
});

describe("redact — email / passport / JSHSHIR", () => {
  it("redacts email", () => {
    const r = redact("Контакт: patient@example.com — пишите.");
    expect(r.redacted).not.toContain("patient@example.com");
    expect(r.redacted).toMatch(/<EMAIL_1>/);
  });

  it("redacts UZ passport AA 1234567", () => {
    const r = redact("Серия паспорта AA 1234567 проверена.");
    expect(r.redacted).not.toContain("AA 1234567");
    expect(r.redacted).toMatch(/<PASSPORT_1>/);
  });

  it("redacts JSHSHIR 14-digit pin", () => {
    const r = redact("ЖШШИР: 12345678901234 в карте.");
    expect(r.redacted).not.toContain("12345678901234");
    expect(r.redacted).toMatch(/<PASSPORT_1>/);
  });
});

describe("redact — mixed corpus", () => {
  it("scrubs phone + name + email together without overlaps", () => {
    const input =
      "Сафаров (тел +998 90 123 45 67, email saf@clinic.uz) пришёл на приём.";
    const r = redactWithKnownNames(input, ["Сафаров"]);
    expect(r.redacted).not.toContain("Сафаров");
    expect(r.redacted).not.toContain("+998 90 123 45 67");
    expect(r.redacted).not.toContain("saf@clinic.uz");
    expect(r.replacements.map((x) => x.kind).sort()).toEqual(
      ["EMAIL", "NAME", "PHONE"].sort(),
    );
  });
});

describe("redact / unredact round-trip", () => {
  function roundTrip(input: string, names: string[] = []): void {
    const r = redactWithKnownNames(input, names);
    const back = unredact(r.redacted, r.replacements);
    expect(back).toBe(input);
  }

  it("round-trips a phone-heavy string", () => {
    roundTrip("Позвоните +998 90 123 45 67 или +998901234567.");
  });

  it("round-trips name + phone + email", () => {
    roundTrip(
      "Алишер Каримов: +998901234567, mail patient@example.com.",
      ["Алишер Каримов"],
    );
  });

  it("round-trips repeated names (dedup)", () => {
    roundTrip("Сафаров пришёл, потом Сафаров ушёл.", ["Сафаров"]);
  });
});

describe("redact — negative cases (must NOT redact)", () => {
  it("empty input returns empty replacements", () => {
    const r = redact("");
    expect(r.redacted).toBe("");
    expect(r.replacements).toEqual([]);
  });

  it("no PII returns the input unchanged", () => {
    const input = "Простой текст без персональных данных.";
    const r = redact(input);
    expect(r.redacted).toBe(input);
    expect(r.replacements).toEqual([]);
  });

  it("does not redact medical dosage like 500mg / 5mg", () => {
    const input = "Назначен Trizolinum 500mg, потом 5mg вечером.";
    const r = redact(input);
    expect(r.redacted).toBe(input);
  });

  it("does not redact times like 12:30 or dates 12.04.2026", () => {
    const input = "Приём 12.04.2026 в 12:30 утра.";
    const r = redact(input);
    expect(r.redacted).toBe(input);
  });

  it("does not redact prices 1 500 000", () => {
    const input = "Стоимость услуги — 1 500 000 сум.";
    const r = redact(input);
    expect(r.redacted).toBe(input);
  });

  it("does not redact ICD codes (G43.0 etc)", () => {
    const input = "Диагноз G43.0 (мигрень без ауры).";
    const r = redact(input);
    expect(r.redacted).toBe(input);
  });
});

describe("RedactionResult shape", () => {
  it("token format is <KIND_N>, 1-indexed", () => {
    const r: RedactionResult = redact(
      "Тел +998901234567, email a@b.com, ещё +998901234568.",
    );
    const tokens = r.replacements.map((x) => x.token);
    expect(tokens).toContain("<PHONE_1>");
    expect(tokens).toContain("<PHONE_2>");
    expect(tokens).toContain("<EMAIL_1>");
  });

  it("each replacement carries its original substring", () => {
    const r = redact("Email a@b.com.");
    const email = r.replacements.find((x) => x.kind === "EMAIL");
    expect(email?.original).toBe("a@b.com");
  });
});
