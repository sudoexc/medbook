/**
 * Phase 19 Wave 4 — branding PATCH validation + i18n parity.
 *
 * The DB-bound write path is integration-tested. Here we lock in the schema
 * contract (hex regex, subdomain refinement, transparent "" → clear), and
 * verify both message bundles ship the `branding.*` keys.
 */
import { describe, it, expect } from "vitest";

import { UpdateBrandingSchema } from "@/server/schemas/settings";
import ru from "@/messages/ru.json" with { type: "json" };
import uz from "@/messages/uz.json" with { type: "json" };

describe("UpdateBrandingSchema", () => {
  it("accepts a brand-color hex without secondary", () => {
    const r = UpdateBrandingSchema.safeParse({ brandColor: "#3DD5C0" });
    expect(r.success).toBe(true);
  });

  it("rejects a brand-color that is not 6-hex", () => {
    const r = UpdateBrandingSchema.safeParse({ brandColor: "red" });
    expect(r.success).toBe(false);
  });

  it("accepts brandSecondaryColor: null (explicit clear)", () => {
    const r = UpdateBrandingSchema.safeParse({ brandSecondaryColor: null });
    expect(r.success).toBe(true);
  });

  it("accepts customSubdomain: '' (clear sentinel)", () => {
    const r = UpdateBrandingSchema.safeParse({ customSubdomain: "" });
    expect(r.success).toBe(true);
  });

  it("accepts customSubdomain: null (clear)", () => {
    const r = UpdateBrandingSchema.safeParse({ customSubdomain: null });
    expect(r.success).toBe(true);
  });

  it("normalises customSubdomain to lower-case", () => {
    const r = UpdateBrandingSchema.parse({ customSubdomain: "My-Clinic" });
    expect(r.customSubdomain).toBe("my-clinic");
  });

  it("rejects reserved customSubdomain (api)", () => {
    const r = UpdateBrandingSchema.safeParse({ customSubdomain: "api" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict mode)", () => {
    const r = UpdateBrandingSchema.safeParse({
      brandColor: "#000000",
      foo: "bar",
    });
    expect(r.success).toBe(false);
  });
});

describe("branding i18n parity (RU / UZ)", () => {
  // Spot-check the keys the page reads — the project-wide parity sweep tests
  // every namespace; this test pins the W4-added keys explicitly so a
  // partial bundle update is caught early.
  const KEYS = [
    "title",
    "description",
    "save",
    "saving",
    "saved",
    "loading",
  ] as const;

  it.each(KEYS)("ru.branding.%s is non-empty", (k) => {
    const v = (ru as Record<string, unknown>).branding as Record<string, string>;
    expect(typeof v[k]).toBe("string");
    expect(v[k].length).toBeGreaterThan(0);
  });

  it.each(KEYS)("uz.branding.%s is non-empty", (k) => {
    const v = (uz as Record<string, unknown>).branding as Record<string, string>;
    expect(typeof v[k]).toBe("string");
    expect(v[k].length).toBeGreaterThan(0);
  });

  it("RU and UZ branding namespaces have the same key set", () => {
    const ruKeys = Object.keys(
      (ru as Record<string, unknown>).branding as Record<string, unknown>,
    ).sort();
    const uzKeys = Object.keys(
      (uz as Record<string, unknown>).branding as Record<string, unknown>,
    ).sort();
    expect(ruKeys).toEqual(uzKeys);
  });

  it("RU and UZ admin.bulk namespaces have the same key set", () => {
    const ruKeys = Object.keys(
      ((ru as Record<string, unknown>).admin as Record<string, unknown>)
        .bulk as Record<string, unknown>,
    ).sort();
    const uzKeys = Object.keys(
      ((uz as Record<string, unknown>).admin as Record<string, unknown>)
        .bulk as Record<string, unknown>,
    ).sort();
    expect(ruKeys).toEqual(uzKeys);
  });
});
