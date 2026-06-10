/**
 * Ф4 — clinic catalog overlay: whitelist sanitizer + read-time merge.
 *
 * These two pure functions are the security boundary of the override
 * feature: whatever lands in `overridesJson` (API call or hand-edited DB
 * row), only whitelisted fields may ever reach a doctor-facing row. Tested
 * DB-free.
 */
import { describe, expect, it } from "vitest";

import {
  OVERLAY_FIELD_WHITELIST,
  applyClinicOverlay,
  isOverridableEntityType,
  sanitizeOverrides,
} from "@/server/catalog/clinic-overlay";

describe("sanitizeOverrides", () => {
  it("returns null for non-object payloads", () => {
    expect(sanitizeOverrides("DRUG", null)).toBeNull();
    expect(sanitizeOverrides("DRUG", undefined)).toBeNull();
    expect(sanitizeOverrides("DRUG", "nameRu")).toBeNull();
    expect(sanitizeOverrides("DRUG", 42)).toBeNull();
    expect(sanitizeOverrides("DRUG", ["nameRu"])).toBeNull();
  });

  it("keeps only whitelisted keys", () => {
    const out = sanitizeOverrides("DRUG", {
      nameRu: "Бисопролол (наш)",
      rxOnly: false,
      id: "evil-id",
      clinicId: "evil-clinic",
      active: false,
      inn: "evil-inn",
    });
    expect(out).toEqual({ nameRu: "Бисопролол (наш)", rxOnly: false });
  });

  it("drops undefined values but keeps null and falsy ones", () => {
    const out = sanitizeOverrides("HANDOUT", {
      titleRu: "Памятка",
      titleUz: null,
      summaryRu: undefined,
      bodyMd: "",
    });
    expect(out).toEqual({ titleRu: "Памятка", titleUz: null, bodyMd: "" });
  });

  it("returns null when nothing whitelisted survives", () => {
    expect(sanitizeOverrides("DRUG", {})).toBeNull();
    expect(sanitizeOverrides("DRUG", { id: "x", category: "GI" })).toBeNull();
  });

  it("respects the per-type whitelist", () => {
    // `bodyMd` is a HANDOUT field, not a GUIDE field.
    expect(sanitizeOverrides("GUIDE", { bodyMd: "x" })).toBeNull();
    expect(
      sanitizeOverrides("GUIDE", { redFlagsRu: "Температура > 39" }),
    ).toEqual({ redFlagsRu: "Температура > 39" });
  });
});

describe("isOverridableEntityType", () => {
  it("accepts exactly the whitelisted types", () => {
    for (const t of Object.keys(OVERLAY_FIELD_WHITELIST)) {
      expect(isOverridableEntityType(t as never)).toBe(true);
    }
    expect(isOverridableEntityType("PROTOCOL")).toBe(false);
    expect(isOverridableEntityType("LAB_TEST")).toBe(false);
    expect(isOverridableEntityType("LAB_PANEL")).toBe(false);
  });
});

describe("applyClinicOverlay", () => {
  const overlays = {
    overrides: new Map<string, Record<string, unknown>>([
      ["bisoprolol", { nameRu: "Бисопролол (клиника)", rxOnly: false }],
      ["amoxicillin", { id: "evil", nameUz: "Amoksitsillin" }],
    ]),
  };

  const row = {
    id: "bisoprolol",
    inn: "bisoprolol",
    nameRu: "Бисопролол",
    nameUz: null as string | null,
    rxOnly: true,
  };

  it("merges the patch and flags the row", () => {
    const out = applyClinicOverlay(row, "bisoprolol", overlays, "DRUG");
    expect(out.nameRu).toBe("Бисопролол (клиника)");
    expect(out.rxOnly).toBe(false);
    expect(out.inn).toBe("bisoprolol");
    expect(out.clinicOverridden).toBe(true);
  });

  it("passes rows without a patch through unchanged", () => {
    const out = applyClinicOverlay(row, "no-such-code", overlays, "DRUG");
    expect(out).toEqual({ ...row, clinicOverridden: false });
  });

  it("never lets non-whitelisted keys leak through a stored patch", () => {
    const out = applyClinicOverlay(
      { id: "amoxicillin", nameRu: "Амоксициллин", nameUz: null },
      "amoxicillin",
      overlays,
      "DRUG",
    );
    expect(out.id).toBe("amoxicillin");
    expect(out.nameUz).toBe("Amoksitsillin");
    expect(out.clinicOverridden).toBe(true);
  });

  it("treats an all-junk stored patch as no override", () => {
    const junk = {
      overrides: new Map([["code-1", { id: "evil", active: false }]]),
    };
    const out = applyClinicOverlay(
      { id: "code-1", nameRu: "X", active: true },
      "code-1",
      junk,
      "DRUG",
    );
    expect(out).toEqual({
      id: "code-1",
      nameRu: "X",
      active: true,
      clinicOverridden: false,
    });
  });
});
