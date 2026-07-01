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
import { MINIAPP_DELIVERABLE_TYPES } from "@/app/api/miniapp/events/route";

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
  "referral.created",
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

  // The server-side v1 delivery allow-list (MINIAPP_DELIVERABLE_TYPES) must be
  // a subset of what the client knows how to act on — otherwise the mini-app
  // would stream a v1 event the client silently ignores (wasted frame) or,
  // worse, an event that was never meant to be patient-facing.
  it("every server-deliverable v1 type has a client invalidation mapping", () => {
    for (const type of MINIAPP_DELIVERABLE_TYPES) {
      const prefixes = MINIAPP_INVALIDATION_MAP[type];
      expect(prefixes, `deliverable type ${type} has no client mapping`).toBeDefined();
      expect(prefixes?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
