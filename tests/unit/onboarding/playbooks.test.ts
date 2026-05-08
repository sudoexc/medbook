/**
 * Phase 19 Wave 2 — onboarding playbook catalog shape tests.
 *
 * DB-less. Asserts every playbook in the registry meets the wave's
 * "≥ 5 services + ≥ 3 templates + valid HH:MM schedule + RU/UZ parity"
 * contract, and that every template references a `TriggerKey` that
 * `triggerKeyToDbShape` can map back to a `NotificationTrigger` enum row.
 *
 * Fast safety net so a future contributor can't ship a playbook that
 * fails silently when the applier runs against a real clinic.
 */
import { describe, it, expect } from "vitest";

import {
  PLAYBOOKS,
  PLAYBOOK_SLUGS,
  isPlaybookSlug,
  triggerKeyToDbShape,
  type PlaybookSlug,
} from "@/server/onboarding/playbooks";

const TIME_RX = /^([01]\d|2[0-3]):[0-5]\d$/;
const SLUG_RX = /^[a-z][a-z0-9-]*$/;

describe("playbooks / catalog shape", () => {
  it("ships exactly 5 playbooks", () => {
    expect(PLAYBOOK_SLUGS.length).toBe(5);
    expect(new Set(PLAYBOOK_SLUGS).size).toBe(5);
  });

  it("registry exposes every declared slug", () => {
    for (const slug of PLAYBOOK_SLUGS) {
      expect(PLAYBOOKS[slug]).toBeDefined();
      expect(PLAYBOOKS[slug].slug).toBe(slug);
    }
  });

  it("isPlaybookSlug accepts catalog entries and rejects strangers", () => {
    for (const slug of PLAYBOOK_SLUGS) {
      expect(isPlaybookSlug(slug)).toBe(true);
    }
    expect(isPlaybookSlug("blank")).toBe(false);
    expect(isPlaybookSlug("")).toBe(false);
    expect(isPlaybookSlug(null)).toBe(false);
    expect(isPlaybookSlug(123)).toBe(false);
  });
});

describe.each(PLAYBOOK_SLUGS as readonly PlaybookSlug[])(
  "playbooks / %s",
  (slug) => {
    const pb = PLAYBOOKS[slug];

    it("has RU and UZ display names", () => {
      expect(pb.nameRu.length).toBeGreaterThan(0);
      expect(pb.nameUz.length).toBeGreaterThan(0);
    });

    it("ships ≥ 5 services", () => {
      expect(pb.services.length).toBeGreaterThanOrEqual(5);
    });

    it("service codes are slug-shaped and unique", () => {
      const codes = pb.services.map((s) => s.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const c of codes) {
        expect(c).toMatch(SLUG_RX);
      }
    });

    it("each service has positive duration + price and RU/UZ name parity", () => {
      for (const svc of pb.services) {
        expect(svc.durationMin).toBeGreaterThan(0);
        expect(svc.priceTiins).toBeGreaterThan(0);
        // Tiins (1 UZS = 100). If someone forgot the multiplier we'd see
        // values < 1000 (10 UZS) which is nonsensical for a clinic visit.
        expect(svc.priceTiins).toBeGreaterThanOrEqual(1_000_000);
        expect(svc.nameRu.trim().length).toBeGreaterThan(0);
        expect(svc.nameUz.trim().length).toBeGreaterThan(0);
      }
    });

    it("ships ≥ 3 notification templates with the booking trio", () => {
      expect(pb.templates.length).toBeGreaterThanOrEqual(3);
      const triggers = new Set(pb.templates.map((t) => t.trigger));
      expect(triggers.has("appointment.created")).toBe(true);
      expect(triggers.has("appointment.reminder-24h")).toBe(true);
      expect(triggers.has("appointment.reminder-2h")).toBe(true);
    });

    it("every template trigger is mappable to a DB enum shape", () => {
      for (const tpl of pb.templates) {
        const shape = triggerKeyToDbShape(tpl.trigger);
        expect(shape).not.toBeNull();
        expect(shape!.key.length).toBeGreaterThan(0);
      }
    });

    it("every template carries non-empty RU + UZ bodies", () => {
      for (const tpl of pb.templates) {
        expect(tpl.bodyRu.trim().length).toBeGreaterThan(0);
        expect(tpl.bodyUz.trim().length).toBeGreaterThan(0);
      }
    });

    it("schedule is in HH:MM 24h with end > start and slotMin in [10..120]", () => {
      expect(pb.schedule.workdayStart).toMatch(TIME_RX);
      expect(pb.schedule.workdayEnd).toMatch(TIME_RX);
      const toMin = (s: string) => {
        const [h, m] = s.split(":").map(Number);
        return h * 60 + m;
      };
      expect(toMin(pb.schedule.workdayEnd)).toBeGreaterThan(
        toMin(pb.schedule.workdayStart),
      );
      expect(pb.schedule.slotMin).toBeGreaterThanOrEqual(10);
      expect(pb.schedule.slotMin).toBeLessThanOrEqual(120);
    });
  },
);

describe("triggerKeyToDbShape", () => {
  it("maps appointment.created → APPOINTMENT_CREATED with no offset", () => {
    const r = triggerKeyToDbShape("appointment.created");
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe("APPOINTMENT_CREATED");
    expect(r!.triggerConfig).toBeNull();
  });

  it("maps appointment.reminder-24h → APPOINTMENT_BEFORE offset -1440", () => {
    const r = triggerKeyToDbShape("appointment.reminder-24h");
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe("APPOINTMENT_BEFORE");
    expect(r!.triggerConfig).toEqual({ offsetMin: -1440 });
  });

  it("maps appointment.reminder-2h → APPOINTMENT_BEFORE offset -120", () => {
    const r = triggerKeyToDbShape("appointment.reminder-2h");
    expect(r).not.toBeNull();
    expect(r!.trigger).toBe("APPOINTMENT_BEFORE");
    expect(r!.triggerConfig).toEqual({ offsetMin: -120 });
  });
});
