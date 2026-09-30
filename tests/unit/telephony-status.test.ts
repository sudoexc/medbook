/**
 * Audit UX-08: telephony is shown as working only once it works.
 *
 * No PBX adapter exists (LogOnly only) and the SIP webhook needs a secret
 * the settings card never writes. Still, reception always showed the
 * «Call Center / Нет активных звонков» widget and the settings card turned
 * green «Подключено» as soon as a server and a password were saved.
 *
 * Acceptance: without telephony that really delivered calls there is no
 * widget on the desk, and the card says «Не подключено».
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  LOG_ONLY_CALL_ID_PREFIX,
  loadTelephonyStatus,
  telephonyStatusFrom,
} from "@/server/telephony/status";

const AT = new Date("2026-09-30T06:00:00.000Z");

describe("telephonyStatusFrom", () => {
  it("nothing saved: not connected", () => {
    expect(telephonyStatusFrom({ connection: null, lastProviderCallAt: null })).toEqual({
      connected: false,
      configured: false,
      webhookReady: false,
      lastEventAt: null,
    });
  });

  it("server and password saved, no webhook secret: still not connected", () => {
    const out = telephonyStatusFrom({
      connection: { active: true, config: { server: "pbx.local", username: "clinic" } },
      lastProviderCallAt: null,
    });
    expect(out).toMatchObject({ connected: false, configured: true, webhookReady: false });
  });

  it("webhook ready but no call ever arrived: not connected yet", () => {
    const out = telephonyStatusFrom({
      connection: { active: true, config: { webhookSecret: "s3cret" } },
      lastProviderCallAt: null,
    });
    expect(out).toMatchObject({ connected: false, webhookReady: true });
  });

  it("webhook ready and a provider event arrived: connected", () => {
    const out = telephonyStatusFrom({
      connection: { active: true, config: { webhookSecret: "s3cret" } },
      lastProviderCallAt: AT,
    });
    expect(out).toEqual({
      connected: true,
      configured: true,
      webhookReady: true,
      lastEventAt: AT.toISOString(),
    });
  });

  it("a call without the webhook able to accept events proves nothing", () => {
    expect(
      telephonyStatusFrom({ connection: null, lastProviderCallAt: AT }).connected,
    ).toBe(false);
  });
});

describe("loadTelephonyStatus", () => {
  it("reads the webhook's own connection row and ignores LogOnly call ids", async () => {
    const db = {
      providerConnection: {
        findFirst: vi.fn(async () => ({ active: true, config: { webhookSecret: "x" } })),
      },
      call: { findFirst: vi.fn(async () => null) },
    };
    const out = await loadTelephonyStatus(db as never, "c1");
    expect(out.connected).toBe(false);
    expect(db.providerConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicId: "c1", active: true, kind: "OTHER", label: "sip" },
      }),
    );
    expect(db.call.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clinicId: "c1",
          sipCallId: { not: null },
          NOT: { sipCallId: { startsWith: LOG_ONLY_CALL_ID_PREFIX } },
        },
      }),
    );
  });
});

describe("the screens follow the status", () => {
  const read = (rel: string) =>
    readFileSync(path.resolve(__dirname, "../../", rel), "utf8");

  it("reception renders the calls widget only when telephony is connected", () => {
    const src = read("src/app/[locale]/crm/reception/_components/reception-page-client.tsx");
    expect(src).toMatch(/\{telephonyConnected \? \(\s*<CallsWidget/);
    // No polling for calls that cannot arrive.
    expect(src).toContain("useIncomingCalls(telephonyConnected)");
  });

  it("the settings card takes the server's verdict, not the saved row", () => {
    const src = read(
      "src/app/[locale]/crm/settings/integrations/_components/integrations-client.tsx",
    );
    expect(src).toMatch(/stateOverride=\{telephonyConnected \? "ok" : "notConnected"\}/);
  });
});
