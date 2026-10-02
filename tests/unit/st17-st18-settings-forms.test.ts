/**
 * Audit ST-17 and ST-18: settings forms that said one thing and did another.
 *
 *   ST-17 «Шаг сетки» was saved and read by nothing (free slots come from
 *   each doctor's schedule on a fixed grid); the field is gone and the
 *   workday hours say they are what patients see.
 *
 *   ST-18 server refusals showed raw codes and left the screen wrong:
 *     - a clinic email once set could not be cleared ("" failed the schema);
 *     - the cabinet screen matched /cabinet_occupied/ against the message
 *       "CabinetOccupied", so the raw code was shown; reasons now map to
 *       translated text that exists in both languages;
 *     - the cabinet and branch switches stayed flipped after a refusal;
 *     - the Telegram wizard validated the trimmed token but connected with
 *       the untrimmed one.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { UpdateClinicSettingsSchema } from "@/server/schemas/settings";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

const SETTINGS = path.join(process.cwd(), "src/app/[locale]/crm/settings");
const source = (rel: string) => readFileSync(path.join(SETTINGS, rel), "utf8");

function lookup(messages: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
}

describe("ST-18 · clinic email can be cleared", () => {
  it("stores a blank email as null", () => {
    expect(UpdateClinicSettingsSchema.parse({ email: "" }).email).toBeNull();
    expect(UpdateClinicSettingsSchema.parse({ email: "   " }).email).toBeNull();
    expect(UpdateClinicSettingsSchema.parse({ email: null }).email).toBeNull();
  });

  it("still checks a real address and leaves an absent one alone", () => {
    expect(UpdateClinicSettingsSchema.parse({ email: " info@neurofax.uz " }).email).toBe(
      "info@neurofax.uz",
    );
    expect(UpdateClinicSettingsSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect("email" in UpdateClinicSettingsSchema.parse({ nameRu: "NeuroFax" })).toBe(false);
  });
});

describe("ST-18 · cabinet refusals are translated", () => {
  const src = source("cabinets/_components/cabinets-settings-client.tsx");

  it("matches on the reason, not on the raw message", () => {
    expect(src).not.toMatch(/\/cabinet_occupied\/i\.test/);
    expect(src).toMatch(/e instanceof SettingsApiError \? e\.reason/);
  });

  it("every mapped reason has text in ru and uz", () => {
    const block = /CABINET_ERROR_KEYS[^{]*\{([\s\S]*?)\};/.exec(src)?.[1] ?? "";
    const keys = [...block.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]!);
    expect(keys).toContain("cabinets.occupiedError");
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(typeof lookup(ru.settings, key), `ru settings.${key}`).toBe("string");
      expect(typeof lookup(uz.settings, key), `uz settings.${key}`).toBe("string");
    }
  });

  it("cabinet and branch cards put a refused edit back", () => {
    expect(src).toMatch(/patchMutation\.mutate\(\{ id: c\.id, data \}, \{ onError: revert \}\)/);
    const branches = source("branches/_components/branches-settings-client.tsx");
    expect(branches).toMatch(/patchMutation\.mutate\(\{ row: b, data \}, \{ onError: revert \}\)/);
  });
});

describe("ST-18 · Telegram wizard sends the token it validated", () => {
  it("trims the token before connect", () => {
    const src = source("integrations/_components/tg-connect-wizard.tsx");
    expect(src).toMatch(/token: token\.trim\(\),\s*\n\s*expectedUsername/);
  });
});

describe("ST-17 · clinic hours are labelled for patients, no dead grid step", () => {
  const src = source("clinic/_components/clinic-settings-client.tsx");

  it("neither shows nor saves «Шаг сетки»", () => {
    expect(src).not.toMatch(/id="slotMin"/);
    expect(src).not.toMatch(/"slotMin",/);
  });

  it("explains the hours in both languages", () => {
    for (const messages of [ru, uz]) {
      const fields = messages.settings.clinic.fields as Record<string, string>;
      expect(fields.patientHours).toBeTruthy();
      expect(fields.patientHoursHint).toBeTruthy();
      expect(fields.patientHoursHint).not.toMatch(/[—–]/);
    }
  });
});
