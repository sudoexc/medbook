/**
 * Audit UX-12..UX-15, G1-13 — small interface fixes, pinned at the source so
 * they do not drift back:
 *
 *   UX-12  no hard-coded Russian month arrays in the doctor cabinet; no
 *          English captions left in ru.json where the audit found them; the
 *          drug details dialog reads a key that exists.
 *   UX-13  buttons that did nothing are gone or do what they say.
 *   UX-14  the settings and campaign texts no longer promise SMS.
 *   UX-15  the patients rail has no mock action cards and links to pages
 *          that exist.
 *   G1-13  the doctor's upload and replace dialogs take back bytes whose
 *          document was not saved.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const ru = JSON.parse(read("src/messages/ru.json"));
const uz = JSON.parse(read("src/messages/uz.json"));

function get(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

function filesUnder(rel: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, rel))) {
    const child = path.join(rel, name);
    if (statSync(path.join(ROOT, child)).isDirectory()) out.push(...filesUnder(child));
    else if (/\.tsx?$/.test(name)) out.push(child);
  }
  return out;
}

describe("UX-12 doctor cabinet dates and captions", () => {
  it("has no hard-coded Russian month arrays", () => {
    for (const file of filesUnder("src/app/[locale]/doctor")) {
      expect(read(file), file).not.toMatch(/RU_MONTHS|RU_WEEKDAYS|"сентября"|"сент\."/);
    }
  });

  it("the drug details dialog reads a key both locales have", () => {
    const src = read("src/app/[locale]/doctor/references/_components/drug-browser.tsx");
    expect(src).not.toContain("drugs.detailsDescription");
    expect(src).toContain('t("drugs.detailDescription")');
    for (const msgs of [ru, uz]) {
      expect(typeof get(msgs, "doctor.references.drugs.detailDescription")).toBe("string");
    }
  });

  it("translates the captions the audit found in English", () => {
    for (const key of [
      "settings.roles.scope.all",
      "settings.roles.scope.own",
      "settings.roles.scope.today",
      "patients.tiles.noShowRisk",
      "doctor.settings.profile.emailLabel",
    ]) {
      expect(get(ru, key), key).not.toMatch(/\b(all|own|today|No-show|readonly)\b/);
      expect(get(uz, key), key).not.toMatch(/\b(all|own|today|No-show|readonly)\b/);
    }
  });
});

describe("UX-13 buttons that did nothing", () => {
  it("drops «Фильтры» / «Сохранить» on the appointments filter bar", () => {
    const src = read("src/app/[locale]/crm/appointments/_components/appointments-filters.tsx");
    expect(src).not.toContain('t("filters.more")');
    expect(src).not.toContain('t("filters.save")');
  });

  it("«Показать все рекомендации» reveals the hidden ones, and only shows when some are hidden", () => {
    const src = read(
      "src/app/[locale]/crm/patients/[id]/_components/patient-recommendations-card.tsx",
    );
    expect(src).toContain("onClick={() => setExpanded(true)}");
    expect(src).toContain("hiddenCount > 0 ?");
    expect(src).not.toContain("out.slice(0, 3)");
  });

  it("drops the doctor cabinet's «Настроить вид», «Показать ещё» and the diagnosis «i»", () => {
    expect(read("src/app/[locale]/doctor/patients/_components/patients-header.tsx")).not.toContain(
      "actions.configureView",
    );
    expect(
      read("src/app/[locale]/doctor/visits/[patientId]/_components/patient-meta-row-live.tsx"),
    ).not.toContain("meta.showMore");
    expect(
      read("src/app/[locale]/doctor/visits/[patientId]/_components/visits-list.tsx"),
    ).not.toContain("table.diagnosisInfo");
  });

  it("reception recommendation buttons name the screen they open instead of claiming an action", () => {
    const src = read("src/app/[locale]/crm/reception/_components/bottom-row.tsx");
    expect(src).not.toContain("toast.info(");
    expect(ru.reception.bottomRow.recApply).toBe("Открыть расписание");
    expect(ru.reception.bottomRow.recSend).toBe("Открыть центр действий");
    expect(uz.reception.bottomRow.recApply).not.toBe("Qo'llash");
    expect(uz.reception.bottomRow.recSend).not.toBe("Yuborish");
  });
});

describe("UX-14 no SMS promises", () => {
  it("rules, campaign and settings texts say Telegram only", () => {
    for (const key of [
      "settings.notifications.rules.channelsDefault",
      "notifications.campaignsNew.step2.subtitle",
      "settings.index.clinicManagementHint",
      "settings.cards.notifications.description",
      "reception.tg.emptyHint",
    ]) {
      expect(get(ru, key), key).not.toMatch(/SMS|СМС/i);
      expect(get(uz, key), key).not.toMatch(/SMS/i);
    }
  });
});

describe("UX-15 patients rail", () => {
  const src = read("src/app/[locale]/crm/patients/_components/patients-right-rail.tsx");

  it("has no mock action cards with made-up counts", () => {
    expect(src).not.toContain("cursor-pointer");
    expect(src).not.toContain("segments.VIP + segments.DORMANT");
    expect(src).not.toContain('t("actions.');
  });

  it("links to the Action Center and to no missing segments index", () => {
    expect(src).toContain("href={`/${locale}/crm/action-center`}");
    expect(src).not.toContain('t("viewAllSegments")');
  });
});

describe("G1-13 doctor uploads leave no orphans", () => {
  for (const file of [
    "src/app/[locale]/doctor/documents/_components/upload-document-dialog.tsx",
    "src/app/[locale]/doctor/_components/document-edit-dialogs.tsx",
  ]) {
    it(`${path.basename(file)} discards the upload when the document is not saved`, () => {
      const src = read(file);
      expect(src).toContain("uploadDocumentFile(");
      expect(src).toContain("void discardDocumentUpload(stored.fileUrl, stored.uploadToken)");
      // The bytes are kept only once the document points at them.
      expect(src).toContain("stored = null;");
    });
  }
});
