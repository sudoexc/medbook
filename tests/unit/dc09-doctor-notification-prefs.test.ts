/**
 * Audit DC-09 — the doctor's 12 notification switches were saved and never
 * read: «В системе» off and the message toasts kept ringing, Telegram on and
 * nothing ever came.
 *
 * Pinned:
 *   1. Only the cells something honours are offered: today the in-app alert
 *      for a new message; the tab says the rest is not connected.
 *   2. That switch gates the cabinet's message alert (toast and sound), and
 *      shares its cache with the settings tab so a flip applies at once.
 *   3. Unknown (loading, failed) keeps the model default: alerts on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DOCTOR_NOTIFICATION_PREFS_KEY,
  doctorWantsMessageAlerts,
  isWiredDoctorPrefCell,
  wiredDoctorPrefMatrix,
} from "@/lib/doctor-notification-prefs";
import { notificationPrefsKey } from "@/app/[locale]/doctor/settings/_hooks/use-doctor-notification-prefs";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("DC-09: only switches that do something", () => {
  it("offers the new-message in-app alert and nothing else", () => {
    expect(wiredDoctorPrefMatrix()).toEqual({
      events: ["messageNew"],
      channels: ["inApp"],
    });
    expect(isWiredDoctorPrefCell("messageNew_inApp")).toBe(true);
    for (const dead of [
      "messageNew_telegram",
      "messageNew_email",
      "appointmentCreated_inApp",
      "labResultReceived_inApp",
      "reminderDue_telegram",
    ]) {
      expect(isWiredDoctorPrefCell(dead)).toBe(false);
    }
  });

  it("the tab renders from the wired matrix and says what is not connected", () => {
    const src = read(
      "src/app/[locale]/doctor/settings/_components/notifications-tab.tsx",
    );
    expect(src).toContain("wiredDoctorPrefMatrix()");
    expect(src).toContain('t("notifications.notConnected")');
    // The hint promised a Telegram bot link that does not exist.
    expect(src).not.toContain("telegramHint");
  });
});

describe("DC-09: the switch gates the cabinet's message alert", () => {
  it("rings by default and while unknown, stays silent when switched off", () => {
    expect(doctorWantsMessageAlerts(undefined)).toBe(true);
    expect(doctorWantsMessageAlerts(null)).toBe(true);
    expect(doctorWantsMessageAlerts({ messageNew_inApp: true })).toBe(true);
    expect(doctorWantsMessageAlerts({ messageNew_inApp: false })).toBe(false);
  });

  it("the settings tab and the alert read one cache entry", () => {
    expect(notificationPrefsKey).toBe(DOCTOR_NOTIFICATION_PREFS_KEY);
  });

  it("GlobalTgAlerts checks the switch before any toast or sound", () => {
    const src = read("src/components/layout/global-tg-alerts.tsx");
    expect(src).toContain("queryKey: DOCTOR_NOTIFICATION_PREFS_KEY");
    expect(src).toContain('enabled: scope === "doctor"');
    expect(src).toContain("doctorWantsMessageAlerts(prefs.data)");
    expect(src).toMatch(/if \(!wantsAlertsRef\.current\) return;/);
  });
});
