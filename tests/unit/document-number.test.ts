/**
 * Ф0 (TZ-smart-constructor) — document-number helpers.
 *
 * The allocator's race-safety lives in the DB (createMany skipDuplicates +
 * atomic increment); here we pin the pure parts: prefix derivation from the
 * clinic slug and the printed format.
 */
import { describe, expect, it } from "vitest";

import {
  deriveNumberPrefix,
  formatDocumentNumber,
} from "@/server/services/document-number";

describe("deriveNumberPrefix", () => {
  it("uses initials for multi-word slugs", () => {
    expect(deriveNumberPrefix("neuro-fax")).toBe("NF");
    expect(deriveNumberPrefix("med-book-uz")).toBe("MBU");
  });

  it("uppercases single-word slugs whole", () => {
    expect(deriveNumberPrefix("neurofax")).toBe("NEUROFAX");
  });

  it("caps at 10 characters", () => {
    expect(deriveNumberPrefix("superlongclinicslug")).toBe("SUPERLONGC");
    expect(
      deriveNumberPrefix("a-b-c-d-e-f-g-h-i-j-k-l-m"),
    ).toBe("ABCDEFGHIJ");
  });

  it("falls back to DOC for empty slugs", () => {
    expect(deriveNumberPrefix("")).toBe("DOC");
    expect(deriveNumberPrefix("---")).toBe("DOC");
  });
});

describe("formatDocumentNumber", () => {
  it("pads the counter to six digits", () => {
    expect(formatDocumentNumber("NF", 2026, 123)).toBe("NF-2026-000123");
    expect(formatDocumentNumber("NF", 2026, 1)).toBe("NF-2026-000001");
  });

  it("keeps large counters intact", () => {
    expect(formatDocumentNumber("NF", 2026, 1234567)).toBe("NF-2026-1234567");
  });
});
