/**
 * Unit tests for the notification template engine.
 * Covers render substitution, HTML escape, nested key resolution, missing
 * keys, validator whitelist, and placeholder extraction.
 */
import { describe, it, expect } from "vitest";

import {
  render,
  renderWithReport,
  extractPlaceholders,
  validate,
  ALLOWED_KEYS_BY_TRIGGER,
} from "@/server/notifications/template";

describe("render", () => {
  it("substitutes top-level keys", () => {
    const out = render("Hello, {{name}}", { name: "Anna" });
    expect(out).toBe("Hello, Anna");
  });

  it("substitutes nested keys with dot notation", () => {
    const out = render("{{patient.name}} at {{clinic.name}}", {
      patient: { name: "Ivan" },
      clinic: { name: "Neurofax" },
    });
    expect(out).toBe("Ivan at Neurofax");
  });

  it("escapes HTML in substituted values", () => {
    const out = render("Hi {{name}}", { name: "<script>alert(1)</script>" });
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("tolerates whitespace around the key", () => {
    const out = render("X {{  foo }} Y", { foo: "ok" });
    expect(out).toBe("X ok Y");
  });

  it("renders missing keys as empty string", () => {
    const out = render("A {{missing}} B", {});
    expect(out).toBe("A  B");
  });

  it("leaves literal text untouched", () => {
    const out = render("just a string", {});
    expect(out).toBe("just a string");
  });

  it("stringifies numbers and booleans", () => {
    const out = render("{{n}} + {{b}}", { n: 42, b: true });
    expect(out).toBe("42 + true");
  });
});

describe("renderWithReport", () => {
  it("reports missing placeholders", () => {
    const r = renderWithReport("Hi {{a}} and {{b}}", { a: "x" });
    expect(r.output).toBe("Hi x and ");
    expect(r.missing).toContain("b");
    expect(r.placeholders.sort()).toEqual(["a", "b"]);
  });

  it("does not double-count duplicate placeholders", () => {
    const r = renderWithReport("{{a}} {{a}}", { a: "1" });
    expect(r.placeholders).toEqual(["a"]);
  });
});

describe("extractPlaceholders", () => {
  it("returns unique keys", () => {
    const keys = extractPlaceholders("{{a}} {{b.c}} {{a}}").sort();
    expect(keys).toEqual(["a", "b.c"]);
  });
});

describe("validate", () => {
  it("flags unknown placeholders", () => {
    const r = validate("Hi {{patient.name}} and {{hack.code}}", [
      "patient.name",
    ]);
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["hack.code"]);
  });

  it("passes when all keys are whitelisted", () => {
    const r = validate("Hi {{patient.name}}", ["patient.name", "clinic.name"]);
    expect(r.ok).toBe(true);
    expect(r.unknown).toEqual([]);
  });

  it("empty template passes", () => {
    const r = validate("no placeholders here", ["anything"]);
    expect(r.ok).toBe(true);
  });
});

describe("ALLOWED_KEYS_BY_TRIGGER", () => {
  it("covers all 7 required triggers", () => {
    const expected = [
      "appointment.created",
      "appointment.reminder-24h",
      "appointment.reminder-2h",
      "appointment.cancelled",
      "birthday",
      "no-show",
      "payment.due",
    ].sort();
    expect(Object.keys(ALLOWED_KEYS_BY_TRIGGER).sort()).toEqual(expected);
  });

  it("every trigger whitelist includes patient.name", () => {
    for (const [key, list] of Object.entries(ALLOWED_KEYS_BY_TRIGGER)) {
      expect(list, `${key} must include patient.name`).toContain(
        "patient.name",
      );
    }
  });
});
