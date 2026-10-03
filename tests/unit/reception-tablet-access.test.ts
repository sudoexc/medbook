/**
 * The reception tablet's audience, its web app manifest (route included)
 * and its refusals in words (src/lib/reception-tablet/access.ts, errors.ts).
 */
import { describe, expect, it } from "vitest";

import {
  buildReceptionTabletManifest,
  canUseReceptionTablet,
  receptionTabletManifestUrl,
  receptionTabletPath,
} from "@/lib/reception-tablet/access";
import {
  isNetworkError,
  readWriteFailure,
  TabletWriteError,
} from "@/lib/reception-tablet/errors";

describe("who works the tablet", () => {
  it("the desk, the administrator and a SUPER_ADMIN visiting the clinic", () => {
    for (const role of ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"]) {
      expect(canUseReceptionTablet(role), role).toBe(true);
    }
  });

  it("nobody else", () => {
    for (const role of ["DOCTOR", "NURSE", "CALL_OPERATOR", "", null, undefined]) {
      expect(canUseReceptionTablet(role), String(role)).toBe(false);
    }
  });
});

describe("«Добавить на экран Домой»", () => {
  it("opens the tablet page itself, standalone, in the page's language", () => {
    const ru = buildReceptionTabletManifest("ru");
    expect(ru).toMatchObject({
      start_url: "/crm/reception/tablet",
      display: "standalone",
      lang: "ru",
      short_name: "Ресепшн",
    });
    const uz = buildReceptionTabletManifest("uz");
    expect(uz.start_url).toBe("/uz/crm/reception/tablet");
    expect(uz.lang).toBe("uz");
    expect(buildReceptionTabletManifest("xx").lang).toBe("ru");
  });

  it("keeps a sign-in inside the same full screen window", () => {
    expect(buildReceptionTabletManifest("ru").scope).toBe("/");
  });

  it("square PNG icons the home screen can use", () => {
    const icons = buildReceptionTabletManifest("ru").icons;
    expect(icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    for (const i of icons) expect(i.src).toMatch(/^\/reception-tablet\/icon-\d+\.png$/);
  });

  it("names carry no dash", () => {
    for (const lang of ["ru", "uz"]) {
      const m = buildReceptionTabletManifest(lang);
      expect(`${m.name} ${m.short_name} ${m.description}`).not.toMatch(/[—–]/);
    }
  });

  it("the manifest is linked with the page's language", () => {
    expect(receptionTabletManifestUrl("uz")).toBe("/reception-tablet.webmanifest?lang=uz");
    expect(receptionTabletManifestUrl("ru")).toBe("/reception-tablet.webmanifest?lang=ru");
    expect(receptionTabletPath("ru")).toBe("/crm/reception/tablet");
  });

  it("GET /reception-tablet.webmanifest answers the manifest as JSON", async () => {
    const { GET } = await import("@/app/reception-tablet.webmanifest/route");
    const res = GET(new Request("https://neurofax.uz/reception-tablet.webmanifest?lang=uz"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/manifest+json");
    const body = await res.json();
    expect(body).toEqual(buildReceptionTabletManifest("uz"));
  });
});

describe("refusals in words", () => {
  it("a taken slot names its reason and the time it frees up", () => {
    expect(readWriteFailure(409, { error: "conflict", reason: "doctor_busy", until: "14:30" })).toEqual({
      kind: "slot",
      reason: "doctor_busy",
      until: "14:30",
    });
    expect(readWriteFailure(409, { error: "conflict", reason: "in_past" })).toEqual({
      kind: "slot",
      reason: "in_past",
    });
  });

  it("the walk-in's and the patient route's codes, whichever field carries them", () => {
    expect(readWriteFailure(400, { error: "bad_phone" })).toEqual({ kind: "known", code: "bad_phone" });
    expect(readWriteFailure(400, { error: "ValidationError", reason: "invalid_phone" })).toEqual({
      kind: "known",
      code: "bad_phone",
    });
    expect(readWriteFailure(404, { error: "doctor_not_found" })).toEqual({
      kind: "known",
      code: "doctor_not_found",
    });
    expect(readWriteFailure(422, { error: "DoctorInvalid", reason: "doctor_not_found" })).toEqual({
      kind: "known",
      code: "doctor_not_found",
    });
    expect(readWriteFailure(409, { error: "conflict", reason: "service_not_offered" })).toEqual({
      kind: "known",
      code: "service_not_offered",
    });
    expect(readWriteFailure(403, { error: "Forbidden" })).toEqual({ kind: "known", code: "forbidden" });
  });

  it("the plan's limit with its number", () => {
    expect(
      readWriteFailure(402, { error: "PlanLimitExceeded", quota: "maxPatients", max: 500 }),
    ).toEqual({ kind: "planLimit", quota: "maxPatients", max: 500 });
  });

  it("anything else is the generic line, never a raw code", () => {
    expect(readWriteFailure(500, null)).toEqual({ kind: "failed" });
    expect(readWriteFailure(400, { error: "ValidationError" })).toEqual({ kind: "failed" });
  });

  it("a request that never got an answer is a lost connection", () => {
    expect(isNetworkError(new TypeError("Load failed"))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isNetworkError(new TabletWriteError({ kind: "failed" }))).toBe(false);
    expect(isNetworkError(new Error("boom"))).toBe(false);
  });
});
