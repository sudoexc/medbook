/**
 * The clinic's self-learning diagnosis catalog — the pure parts.
 *
 * The static list is complete but not exhaustive of wordings, so every
 * diagnosis a doctor typed and SIGNED joins the clinic catalog. These tests
 * pin the query parser («G43.81 Название» → one-click code+name) and the
 * code-shape check that gates what counts as an attachable code.
 */
import { describe, expect, it } from "vitest";

import { parseCodeNameQuery } from "@/lib/icd10-query";
import { looksLikeIcdCode } from "@/server/icd10/clinic-catalog";

describe("parseCodeNameQuery", () => {
  it("splits a code-plus-name query", () => {
    expect(parseCodeNameQuery("G43.81 Мигрень с осложнением")).toEqual({
      code: "G43.81",
      name: "Мигрень с осложнением",
    });
  });

  it("uppercases the code the doctor typed lazily", () => {
    expect(parseCodeNameQuery("g43.81 Мигрень хроническая")?.code).toBe(
      "G43.81",
    );
  });

  it("returns null for a bare code — nothing to pair", () => {
    expect(parseCodeNameQuery("G43.81")).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseCodeNameQuery("мигрень с аурой")).toBeNull();
  });

  it("requires a real name after the code, not one stray letter", () => {
    expect(parseCodeNameQuery("G43 ок")).toBeNull();
  });

  it("survives extra whitespace", () => {
    expect(parseCodeNameQuery("  G43.8   Мигрень другая  ")).toEqual({
      code: "G43.8",
      name: "Мигрень другая",
    });
  });
});

describe("looksLikeIcdCode", () => {
  it("accepts classic and dotted codes", () => {
    expect(looksLikeIcdCode("G43")).toBe(true);
    expect(looksLikeIcdCode("G43.81")).toBe(true);
  });

  it("rejects words and numbers", () => {
    expect(looksLikeIcdCode("мигрень")).toBe(false);
    expect(looksLikeIcdCode("1972")).toBe(false);
    expect(looksLikeIcdCode("G4")).toBe(false);
  });
});
