import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bookHref,
  bookingContextMatches,
} from "@/app/c/[slug]/my/_lib/booking-context";

/**
 * Audit MA-02: a booking started for «Мама» was created on the owner's card
 * because every hop of the wizard dropped `?onBehalfOf`. Her exam and
 * prescriptions then went into his record.
 */

describe("bookHref", () => {
  it("carries the active relative into every step, the done page included", () => {
    for (const step of ["service", "doctor", "slot", "confirm", "done"] as const) {
      const href = bookHref("neurofax", step, "rel_mom");
      const url = new URL(href, "https://x");
      expect(url.pathname).toBe(`/c/neurofax/my/book/${step}`);
      expect(url.searchParams.get("onBehalfOf")).toBe("rel_mom");
    }
  });

  it("booking for oneself adds no context", () => {
    expect(bookHref("neurofax", "doctor", null)).toBe("/c/neurofax/my/book/doctor");
    expect(bookHref("neurofax", "doctor", undefined)).toBe("/c/neurofax/my/book/doctor");
  });

  it("keeps extra params (done ?id=, treatment plan ?caseId=) next to the context", () => {
    const url = new URL(
      bookHref("neurofax", "done", "rel_mom", { id: "apt_1", skip: null }),
      "https://x",
    );
    expect(url.searchParams.get("id")).toBe("apt_1");
    expect(url.searchParams.get("onBehalfOf")).toBe("rel_mom");
    expect(url.searchParams.has("skip")).toBe(false);
  });
});

describe("bookingContextMatches", () => {
  it("submits only for the person the draft was assembled for", () => {
    expect(bookingContextMatches("rel_mom", "rel_mom")).toBe(true);
    expect(bookingContextMatches(null, null)).toBe(true);
    // The bug: draft built for mom, confirm screen reached as the owner.
    expect(bookingContextMatches("rel_mom", null)).toBe(false);
    expect(bookingContextMatches(null, "rel_mom")).toBe(false);
    expect(bookingContextMatches("rel_mom", "rel_son")).toBe(false);
  });

  it("a draft saved before the field existed counts as the owner's", () => {
    expect(bookingContextMatches(undefined, null)).toBe(true);
    expect(bookingContextMatches(undefined, "rel_mom")).toBe(false);
  });
});

describe("wizard navigation never builds a context-less booking URL", () => {
  // Pins the fix: a hand-built `/my/book/...` string anywhere in the Mini
  // App is exactly how the context got dropped. Every hop goes through
  // `bookHref` (the server redirect of /my/book forwards the query itself).
  const root = path.resolve(__dirname, "../../src/app/c/[slug]/my");
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return /\.(tsx?)$/.test(e.name) ? [p] : [];
    });
  }

  it("has no literal /my/book/ hrefs outside booking-context.ts and the root redirect", () => {
    const offenders = walk(root)
      .filter(
        (f) =>
          !f.endsWith(path.join("_lib", "booking-context.ts")) &&
          !f.endsWith(path.join("book", "page.tsx")),
      )
      .filter((f) => readFileSync(f, "utf8").includes("/my/book/"));
    expect(offenders).toEqual([]);
  });
});
