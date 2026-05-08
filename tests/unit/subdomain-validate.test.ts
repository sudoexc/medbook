/**
 * Phase 19 Wave 4 — custom subdomain validator. Pure-function test; no DB.
 */
import { describe, it, expect } from "vitest";

import {
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_REGEX,
  validateSubdomain,
} from "@/server/platform/subdomain";

describe("validateSubdomain", () => {
  it("accepts simple kebab-case labels", () => {
    expect(validateSubdomain("my-clinic")).toEqual({
      ok: true,
      value: "my-clinic",
    });
  });

  it("accepts numeric and mixed labels", () => {
    expect(validateSubdomain("clinic42")).toEqual({
      ok: true,
      value: "clinic42",
    });
  });

  it("normalises to lower-case and trims surrounding whitespace", () => {
    expect(validateSubdomain("  My-Clinic  ")).toEqual({
      ok: true,
      value: "my-clinic",
    });
  });

  it.each(["ab", "a", ""])("rejects labels shorter than 3 chars (%s)", (v) => {
    expect(validateSubdomain(v)).toEqual({ ok: false, reason: "format" });
  });

  it("rejects labels longer than 32 chars", () => {
    expect(validateSubdomain("a".repeat(33))).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("rejects underscores and uppercase that survives trim", () => {
    expect(validateSubdomain("my_clinic")).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("rejects leading and trailing dashes", () => {
    expect(validateSubdomain("-foo")).toEqual({
      ok: false,
      reason: "leading-trailing-dash",
    });
    expect(validateSubdomain("foo-")).toEqual({
      ok: false,
      reason: "leading-trailing-dash",
    });
  });

  it("rejects double dashes", () => {
    expect(validateSubdomain("foo--bar")).toEqual({
      ok: false,
      reason: "double-dash",
    });
  });

  it.each(["www", "api", "admin", "platform"])(
    "rejects reserved label %s",
    (v) => {
      expect(validateSubdomain(v)).toEqual({ ok: false, reason: "reserved" });
    },
  );
});

describe("SUBDOMAIN_REGEX + RESERVED_SUBDOMAINS spot-checks", () => {
  it("regex accepts edge labels at the length bounds", () => {
    expect(SUBDOMAIN_REGEX.test("abc")).toBe(true);
    expect(SUBDOMAIN_REGEX.test("a".repeat(32))).toBe(true);
    expect(SUBDOMAIN_REGEX.test("a".repeat(33))).toBe(false);
  });

  it("reserved set covers infrastructure subdomains", () => {
    expect(RESERVED_SUBDOMAINS.has("api")).toBe(true);
    expect(RESERVED_SUBDOMAINS.has("admin")).toBe(true);
    expect(RESERVED_SUBDOMAINS.has("my-clinic")).toBe(false);
  });
});
