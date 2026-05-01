/**
 * Phase 9d — `computeVisibleNav` resolution.
 *
 * Pure-function tests: no DB, no React. Each tier (basic / pro / enterprise)
 * is run against the production CRM_NAV definition exported from the sidebar
 * to assert the gated entries are actually filtered out for the right plans.
 *
 * The `crm-sidebar.tsx` module is `"use client"`, but it's pure ESM as far
 * as Vitest is concerned — vitest evaluates it server-side without React's
 * runtime, and the static `CRM_NAV` array survives unchanged.
 */
import { describe, it, expect } from "vitest";

import {
  DEFAULT_FLAGS,
  ENTERPRISE_FLAGS,
  computeVisibleNav,
  type FeatureFlags,
} from "@/lib/feature-flags";
import { CRM_NAV, getVisibleCrmNav } from "@/components/layout/crm-sidebar";

const PRO_FLAGS: FeatureFlags = {
  hasTelegramInbox: true,
  hasCallCenter: true,
  hasAnalyticsPro: false,
  maxBranches: 3,
  maxUsers: 20,
};

function nameSet(groups: ReadonlyArray<{ items: { href: string }[] }>): Set<string> {
  const out = new Set<string>();
  for (const g of groups) {
    for (const it of g.items) out.add(it.href);
  }
  return out;
}

describe("computeVisibleNav (pure helper)", () => {
  it("keeps unconditional items regardless of plan", () => {
    const groups = [
      {
        items: [
          { href: "patients" },
          { href: "calendar" },
          { href: "telegram", feature: "hasTelegramInbox" as const },
        ],
      },
    ];
    const out = computeVisibleNav(groups, DEFAULT_FLAGS);
    expect(out).toHaveLength(1);
    expect(out[0].items.map((i) => i.href)).toEqual(["patients", "calendar"]);
  });

  it("filters out items whose feature flag is false", () => {
    const groups = [
      {
        items: [
          { href: "call-center", feature: "hasCallCenter" as const },
          { href: "telegram", feature: "hasTelegramInbox" as const },
        ],
      },
    ];
    expect(computeVisibleNav(groups, DEFAULT_FLAGS)).toEqual([]); // both gated
    const onlyTg = computeVisibleNav(groups, {
      ...DEFAULT_FLAGS,
      hasTelegramInbox: true,
    });
    expect(onlyTg).toHaveLength(1);
    expect(onlyTg[0].items.map((i) => i.href)).toEqual(["telegram"]);
  });

  it("drops a group entirely when every item is filtered out", () => {
    const groups = [
      { labelKey: "communications", items: [{ href: "telegram", feature: "hasTelegramInbox" as const }] },
      { items: [{ href: "patients" }] },
    ];
    const out = computeVisibleNav(groups, DEFAULT_FLAGS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ items: [{ href: "patients" }] });
  });

  it("preserves group-level metadata (e.g. labelKey) on surviving groups", () => {
    const groups = [
      {
        labelKey: "communications",
        items: [
          { href: "sms" },
          { href: "telegram", feature: "hasTelegramInbox" as const },
        ],
      },
    ];
    const out = computeVisibleNav(groups, DEFAULT_FLAGS);
    expect(out[0]).toMatchObject({ labelKey: "communications" });
    expect(out[0].items.map((i) => i.href)).toEqual(["sms"]);
  });

  it("does not mutate the input groups array", () => {
    const groups = [
      { items: [{ href: "telegram", feature: "hasTelegramInbox" as const }] },
    ];
    const before = JSON.stringify(groups);
    computeVisibleNav(groups, DEFAULT_FLAGS);
    expect(JSON.stringify(groups)).toEqual(before);
  });
});

describe("getVisibleCrmNav (CRM sidebar wiring)", () => {
  it("Basic plan hides Telegram + Call Center, keeps everything else", () => {
    const visible = getVisibleCrmNav(DEFAULT_FLAGS);
    const hrefs = nameSet(visible);
    // Pro-only items dropped.
    expect(hrefs.has("telegram")).toBe(false);
    expect(hrefs.has("call-center")).toBe(false);
    // Basic-tier items still visible.
    expect(hrefs.has("patients")).toBe(true);
    expect(hrefs.has("calendar")).toBe(true);
    expect(hrefs.has("doctors")).toBe(true);
    expect(hrefs.has("appointments")).toBe(true);
    expect(hrefs.has("rooms")).toBe(true);
    expect(hrefs.has("services")).toBe(true);
    expect(hrefs.has("documents")).toBe(true);
    expect(hrefs.has("notifications")).toBe(true);
    expect(hrefs.has("sms")).toBe(true);
    expect(hrefs.has("analytics")).toBe(true);
    expect(hrefs.has("settings")).toBe(true);
  });

  it("Pro plan reveals Telegram + Call Center", () => {
    const visible = getVisibleCrmNav(PRO_FLAGS);
    const hrefs = nameSet(visible);
    expect(hrefs.has("telegram")).toBe(true);
    expect(hrefs.has("call-center")).toBe(true);
    // sanity: still has the basic-tier items
    expect(hrefs.has("patients")).toBe(true);
  });

  it("Enterprise plan exposes every nav item", () => {
    const visible = getVisibleCrmNav(ENTERPRISE_FLAGS);
    const everyHref = new Set<string>();
    for (const g of CRM_NAV) for (const i of g.items) everyHref.add(i.href);
    expect(nameSet(visible)).toEqual(everyHref);
  });

  it("Communications group survives on Basic because non-gated items remain", () => {
    const visible = getVisibleCrmNav(DEFAULT_FLAGS);
    const comms = visible.find((g) => g.labelKey === "communications");
    expect(comms).toBeTruthy();
    // sms + notifications remain (not gated).
    expect(comms!.items.map((i) => i.href).sort()).toEqual([
      "notifications",
      "sms",
    ]);
  });
});
