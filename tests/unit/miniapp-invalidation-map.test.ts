/**
 * Phase M3 — sanity-check the mini-app event → React-Query invalidation map.
 *
 * Tied to a single source of truth (`EVENT_TYPES`) so a new event type added
 * later can't silently fall off the realtime path. The test passes when
 * every appointment / family / inbox / profile / nps / pre-visit event has
 * a mapping; the few clinic-only event types (call.*, tg.message.*,
 * action.*, etc.) are explicitly allowlisted as "not patient-facing".
 */
import { describe, expect, it } from "vitest";

import { EVENT_TYPES, type EventType } from "@/server/realtime/events";

import { MINIAPP_INVALIDATION_MAP } from "@/app/c/[slug]/my/_hooks/use-miniapp-live-events";

const PATIENT_FACING: ReadonlyArray<EventType> = [
  "appointment.created",
  "appointment.updated",
  "appointment.statusChanged",
  "appointment.cancelled",
  "appointment.moved",
  "queue.updated",
  "notification.sent",
  "notification.read",
  "patient.profileUpdated",
  "patient.familyLinked",
  "patient.familyUnlinked",
  "nps.submitted",
  "previsit.submitted",
  "payment.paid",
  "eprescription.issued",
  "eprescription.cancelled",
  "lab.result.reviewed",
];

describe("MINIAPP_INVALIDATION_MAP", () => {
  it("covers every patient-facing event with at least one query prefix", () => {
    for (const type of PATIENT_FACING) {
      const prefixes = MINIAPP_INVALIDATION_MAP[type];
      expect(prefixes, `missing mapping for ${type}`).toBeDefined();
      expect(prefixes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("every prefix starts with the miniapp namespace", () => {
    for (const [type, prefixes] of Object.entries(MINIAPP_INVALIDATION_MAP)) {
      for (const prefix of prefixes ?? []) {
        expect(prefix[0], `${type} prefix must be \"miniapp\"`).toBe("miniapp");
      }
    }
  });

  it("every mapped event type is a real EventType (typo guard)", () => {
    const known = new Set<string>(EVENT_TYPES);
    for (const type of Object.keys(MINIAPP_INVALIDATION_MAP)) {
      expect(known.has(type), `unknown event ${type}`).toBe(true);
    }
  });
});
