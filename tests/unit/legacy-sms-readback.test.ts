/**
 * Wave 3 of `docs/TZ-sms-removal.md` — legacy SMS read-path coverage.
 *
 * After SMS was removed as an active channel, the read paths must still
 * round-trip historical data:
 *
 *   1. `CommunicationChannelEnum` retains the literal so legacy
 *      `Communication` rows (logged before the kill-switch) parse through
 *      `QueryCommunicationSchema` and remain queryable.
 *   2. `NotificationPayload` retains the literal so SSE envelopes emitted by
 *      the old outbox before Wave 3 still parse on replay.
 *   3. The patient-card communications timeline's `filterTimeline` helper
 *      surfaces legacy SMS rows under the `COMM` bucket (and the legacy
 *      channel-style filters do not silently drop them either).
 *   4. `resolveChannels` treats `template.channel="SMS"` as an empty list so
 *      the materializer never dispatches SMS even if a legacy template row
 *      slips through after the kill-switch.
 *
 * The Prisma enum drop itself is deferred to Wave 5; until then this test
 * pins the read contract.
 */
import { describe, it, expect } from "vitest";

import {
  CommunicationChannelEnum,
  QueryCommunicationSchema,
} from "@/server/schemas/communication";
import { AppEventSchema } from "@/server/realtime/events";
import { resolveChannels } from "@/server/notifications/rules";
import {
  filterTimeline,
  type CommunicationItem,
} from "@/app/[locale]/crm/patients/[id]/_hooks/use-patient-communications";

describe("legacy SMS read-back (Wave 3 of docs/TZ-sms-removal.md)", () => {
  describe("CommunicationChannelEnum", () => {
    it("still accepts the SMS literal so historical rows parse", () => {
      expect(CommunicationChannelEnum.safeParse("SMS").success).toBe(true);
    });

    it("QueryCommunicationSchema accepts channel=SMS for filtered reads", () => {
      const parsed = QueryCommunicationSchema.safeParse({ channel: "SMS" });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.channel).toBe("SMS");
    });
  });

  describe("NotificationPayload via AppEventSchema", () => {
    it("accepts legacy notification.sent envelopes with channel=SMS", () => {
      const envelope = {
        type: "notification.sent" as const,
        clinicId: "c1",
        at: "2026-01-01T00:00:00.000Z",
        payload: {
          sendId: "n_legacy",
          channel: "SMS",
        },
      };
      const parsed = AppEventSchema.safeParse(envelope);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.type).toBe("notification.sent");
    });
  });

  describe("filterTimeline surfaces legacy SMS communications", () => {
    const legacySmsItem: CommunicationItem = {
      id: "c_legacy_sms",
      kind: "communication",
      at: "2026-01-15T08:00:00.000Z",
      channel: "SMS",
      direction: "OUT",
      title: "Напоминание о визите",
      body: "Завтра в 10:00",
      category: "COMM",
    };
    const tgItem: CommunicationItem = {
      id: "c_tg",
      kind: "communication",
      at: "2026-02-15T08:00:00.000Z",
      channel: "TG",
      direction: "OUT",
      title: "Подтвердите запись",
      category: "COMM",
    };

    it("ALL filter returns the legacy SMS row", () => {
      const out = filterTimeline([legacySmsItem, tgItem], "ALL");
      expect(out).toHaveLength(2);
      expect(out.map((x) => x.id)).toContain("c_legacy_sms");
    });

    it("COMM bucket includes the legacy SMS row (kind=communication)", () => {
      const out = filterTimeline([legacySmsItem, tgItem], "COMM");
      expect(out.map((x) => x.id)).toContain("c_legacy_sms");
    });

    it("TG filter does NOT surface the SMS row (channel mismatch is fine)", () => {
      const out = filterTimeline([legacySmsItem, tgItem], "TG");
      expect(out.map((x) => x.id)).toEqual(["c_tg"]);
    });

    it("CALL filter does NOT surface the SMS row", () => {
      const out = filterTimeline([legacySmsItem, tgItem], "CALL");
      expect(out).toHaveLength(0);
    });
  });

  describe("resolveChannels strips legacy SMS template.channel", () => {
    it("template.channel=SMS with no triggerConfig.channels → []", () => {
      // Materializer reads this and falls through to the PATIENT_NO_CHANNEL
      // path (Wave 4) instead of dispatching SMS.
      const out = resolveChannels("SMS", null, { telegramId: "123" });
      expect(out).toEqual([]);
    });

    it("template.channel=SMS with explicit triggerConfig.channels uses the config", () => {
      // If the operator overrode the channel via triggerConfig, the legacy
      // template.channel is ignored entirely — the config wins.
      const out = resolveChannels(
        "SMS",
        { channels: ["TG"] },
        { telegramId: "123" },
      );
      expect(out).toEqual(["TG"]);
    });
  });
});
