/**
 * Audit LD-02 — stored XSS through JSON-LD on the public doctor page.
 *
 * A doctor could save «Невролог</script><script>…</script>» as their
 * specialty; `JSON.stringify` inside `<script type="application/ld+json">`
 * let it close the tag and run on the clinic's origin. Pinned: the shared
 * serialiser never emits a raw `<`, `>` or `&` (nor U+2028/9) and still
 * round-trips; the profile schema refuses markup characters outright.
 */
import { describe, expect, it } from "vitest";

import { serializeJsonLd } from "@/lib/json-ld";
import {
  CreateDoctorSchema,
  DOCTOR_DISPLAY_TEXT_RE,
  doctorDisplayText,
} from "@/server/schemas/doctor";

const PAYLOAD = "Невролог</script><script>alert(1)</script>";

describe("serializeJsonLd", () => {
  it("cannot close the script element", () => {
    const html = serializeJsonLd({
      "@type": "Physician",
      name: "Доктор & Ко",
      medicalSpecialty: PAYLOAD,
    });
    expect(html).not.toMatch(/[<>&]/);
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html.toLowerCase()).not.toContain("</script");
  });

  it("round-trips to the same data for crawlers", () => {
    const data = {
      name: PAYLOAD,
      text: "a\u2028b\u2029c & <d>",
      nested: [{ x: "</SCRIPT >" }],
    };
    const html = serializeJsonLd(data);
    expect(html).not.toContain("\u2028");
    expect(html).not.toContain("\u2029");
    expect(JSON.parse(html)).toEqual(data);
  });

  it("renders an empty object for undefined", () => {
    expect(serializeJsonLd(undefined)).toBe("{}");
  });
});

describe("doctor public name / specialty validation", () => {
  const specialty = doctorDisplayText({ min: 1, max: 200 });

  it("rejects the audit's payload with 400-worthy validation errors", () => {
    expect(specialty.safeParse(PAYLOAD).success).toBe(false);
    expect(specialty.safeParse("<img src=x onerror=alert(1)>").success).toBe(false);
    expect(
      CreateDoctorSchema.shape.specializationRu.safeParse(PAYLOAD).success,
    ).toBe(false);
  });

  it("keeps every real name and title the clinic uses", () => {
    for (const ok of [
      "Детский невролог / педиатр",
      "Кардиология (доп.)",
      "Sultonov Aziz Baxtiyor o‘g‘li",
      "Bolalar nevrologi (qo'sh.)",
      "Невролог, к.м.н.",
      "Врач-невролог высшей категории",
      "ЭЭГ (сон 1 час)",
      "Невролог: эпилептолог",
    ]) {
      expect(DOCTOR_DISPLAY_TEXT_RE.test(ok), ok).toBe(true);
      expect(specialty.safeParse(ok).success, ok).toBe(true);
    }
  });
});
