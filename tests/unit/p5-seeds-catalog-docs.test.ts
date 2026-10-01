/**
 * Seeds, catalog settings and the key runbook (audit P5, seeds-site-docs):
 *
 *   - G2-04: the key-compromise runbook told ops to rotate AUTH_SECRET and
 *     APP_SECRET along with the field key, which breaks every 2FA sign-in,
 *     the clinic bot and the Mini App (no versions, no re-encryption), and
 *     its «key lost» section described a key that is generated for you;
 *   - G4-04: the «Памятки» tab let admins write handouts no patient ever got
 *     (the visit screen has no handout picker), so it is gone;
 *   - G4-09: the preset seeds walked the doctors of every clinic;
 *   - G4-10: seed-drugs deleted every brand of each curated drug, the state
 *     register's ~1800 trade names on those rows with them;
 *   - G4-11: seed-protocols only touches global rows (already fixed in P3,
 *     re-checked here).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { curatedBrandsToAdd } from "../../scripts/_registry-plan";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("G2-04: encryption-key-rotation runbook", () => {
  const doc = read("docs/runbooks/encryption-key-rotation.md");
  const section = (title: string) => {
    const start = doc.indexOf(title);
    expect(start, title).toBeGreaterThan(0);
    const next = doc.indexOf("\n## ", start + title.length);
    return doc.slice(start, next < 0 ? undefined : next);
  };

  it("no longer rotates AUTH_SECRET / APP_SECRET as part of a field-key incident", () => {
    expect(doc).not.toMatch(/also rotate every other secret/);
    const incident = section("## Key-compromise procedure");
    expect(incident).toMatch(/`AUTH_SECRET` and `APP_SECRET` are \*\*not\*\* field-encryption keys/);
    expect(incident).toMatch(/#auth_secret-and-app_secret/);
  });

  it("explains what each secret breaks and the safe procedure", () => {
    const s = section("## AUTH_SECRET and APP_SECRET");
    // What breaks.
    expect(s).toMatch(/Nobody with 2FA can sign in/);
    expect(s).toMatch(/Mini App rejects every patient/);
    expect(s).toMatch(/no re-encryption script/i);
    // Pin APP_SECRET before touching AUTH_SECRET (the KDF falls back to it).
    expect(s).toMatch(/make sure `APP_SECRET` is set on its own/);
    // APP_SECRET is never changed in place: values first, then the key.
    expect(s).toMatch(/`APP_SECRET`: never changed in place/);
    expect(s).toMatch(/"totpSecret" = NULL/);
    expect(s).toMatch(/"tgBotToken" = NULL/);
  });

  it("describes the lost-key recovery the code actually does", () => {
    const s = section("## Recovery — \"I lost the key\"");
    expect(s).not.toMatch(/a new key gets generated as v1/);
    expect(s).toMatch(/refuses to boot/);
    expect(s).toMatch(/new version number/);
    expect(s).toMatch(/ENCRYPTION_DECRYPT_FAILED/);
  });
});

describe("G4-04: no handout tab without a place where handouts are used", () => {
  it("the knowledge settings have no «Памятки» tab and the dead hook is gone", () => {
    const src = read("src/app/[locale]/crm/settings/knowledge/_components/knowledge-client.tsx");
    expect(src).not.toMatch(/HandoutsTab/);
    expect(src).not.toMatch(/value="handouts"/);
    expect(existsSync(path.join(root, "src/app/[locale]/crm/settings/knowledge/_components/handouts-tab.tsx"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/[locale]/doctor/reception/_hooks/use-handouts.ts"))).toBe(false);
  });

  it("the settings texts no longer promise handouts", () => {
    for (const f of ["src/messages/ru.json", "src/messages/uz.json"]) {
      const m = JSON.parse(read(f)) as {
        settings: { knowledge: { subtitle: string }; index?: unknown };
      };
      expect(m.settings.knowledge.subtitle, f).not.toMatch(/памятк|eslatma/i);
    }
  });
});

describe("G4-09: the preset seeds fill one clinic and never delete", () => {
  it("seed-presets.ts needs CLINIC_SLUG and filters doctors by that clinic", () => {
    const src = read("prisma/seed-presets.ts");
    expect(src).not.toMatch(/doctorPreset\.deleteMany/);
    expect(src).toMatch(/process\.env\.CLINIC_SLUG/);
    expect(src).toMatch(/clinicId: clinic\.id,/);
  });

  it("seed-presets-sql.ts scopes its SQL to one slug and checks the slug's characters", () => {
    const src = read("prisma/seed-presets-sql.ts");
    expect(src).not.toMatch(/DELETE FROM "DoctorPreset"/);
    expect(src).toMatch(/\/\^\[a-z0-9-\]\+\$\/\.test\(CLINIC_SLUG\)/);
    expect(src).toMatch(/AND d\."clinicId" = \(SELECT c\.id FROM "Clinic" c WHERE c\.slug = '\$\{CLINIC_SLUG\}'\)/);
  });
});

describe("G4-10: seed-drugs adds curated brands and deletes none", () => {
  it("adds only the curated names a row is missing, folded like the register import", () => {
    expect(
      curatedBrandsToAdd(
        ["МЕЗАКАР® SR", "Финлепсин", "Карбамазепин-ФС"],
        ["Финлепсин®", "финлепсин", "Тегретол", "Тегретол"],
      ),
    ).toEqual(["Тегретол"]);
    expect(curatedBrandsToAdd([], ["Кеторол", "  "])).toEqual(["Кеторол"]);
  });

  it("never deletes a brand row", () => {
    const src = read("prisma/seed-drugs.ts");
    expect(src).not.toMatch(/drugBrand\.deleteMany/);
    expect(src).toMatch(/curatedBrandsToAdd\(/);
  });
});

describe("G4-11: seed-protocols touches global rows only (fixed in P3)", () => {
  it("scopes reads and writes to clinicId null + doctorId null and deletes nothing", () => {
    const seed = read("prisma/_protocol-seed.ts");
    expect(seed).toMatch(/GLOBAL_PROTOCOL_SCOPE = \{ clinicId: null, doctorId: null \}/);
    // Comments still tell the old story; no call is left.
    expect(read("prisma/seed-protocols.ts")).not.toMatch(/\.deleteMany\(/);
    expect(seed).not.toMatch(/\.deleteMany\(/);
  });
});
