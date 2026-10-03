/**
 * «Задачи» board: the wiring around the feature.
 *
 *   - the CRM sidebar shows «Задачи» to the owner, admins and the desk only,
 *     the doctor cabinet has its own item, and the topbar has a title for it;
 *   - ru and uz carry the same texts, with no dashes in what users read;
 *   - the developer's console tool ships in the worker image;
 *   - the migration creates what the schema declares.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getVisibleCrmNav } from "@/components/layout/crm-sidebar";
import { CRM_SECTION_KEY, crmSectionKey } from "@/lib/crm-topbar";
import { DEFAULT_FLAGS, ENTERPRISE_FLAGS } from "@/lib/feature-flags";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

const hasTasks = (role: "ADMIN" | "RECEPTIONIST" | null, flags = DEFAULT_FLAGS) =>
  getVisibleCrmNav(flags, role).some((g) => g.items.some((i) => i.href === "tasks"));

type Tree = { [k: string]: string | Tree };
function flatten(node: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

describe("navigation", () => {
  it("«Задачи» is in the CRM sidebar for admins and the desk, on every plan", () => {
    expect(hasTasks("ADMIN")).toBe(true);
    expect(hasTasks("ADMIN", ENTERPRISE_FLAGS)).toBe(true);
    expect(hasTasks("RECEPTIONIST")).toBe(true);
    // Nurses and call operators reach the sidebar with no nav role.
    expect(hasTasks(null)).toBe(false);
  });

  it("the desk's new nav role does not open the admin-only items", () => {
    const hrefs = getVisibleCrmNav(ENTERPRISE_FLAGS, "RECEPTIONIST").flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("settings");
    expect(hrefs).not.toContain("analytics");
    expect(hrefs).toContain("reception");
  });

  it("the CRM layout passes the desk's role to the sidebar", () => {
    expect(read("src/app/[locale]/crm/layout.tsx")).toMatch(
      /session\?\.user\?\.role === "RECEPTIONIST"\s*\?\s*"RECEPTIONIST"/,
    );
  });

  it("the doctor cabinet has its own «Задачи» item and page", () => {
    expect(read("src/app/[locale]/doctor/_components/doctor-sidebar.tsx")).toMatch(
      /href: "tasks", labelKey: "sidebar\.tasks"/,
    );
    expect(read("src/app/[locale]/doctor/tasks/page.tsx")).toContain("DevTaskBoard");
  });

  it("the topbar titles the section in both languages", () => {
    expect(CRM_SECTION_KEY.tasks).toBe("tasks");
    expect(crmSectionKey("/crm/tasks")).toBe("tasks");
    expect(crmSectionKey("/uz/crm/tasks")).toBe("tasks");
    expect(ru.crmShell.topbar.sections.tasks.title).toBe("Задачи");
    expect(uz.crmShell.topbar.sections.tasks.title).toBeTruthy();
    expect(ru.crmShell.sidebarNav.tasks).toBe("Задачи");
    expect(uz.crmShell.sidebarNav.tasks).toBeTruthy();
    expect(ru.doctor.nav.sidebar.tasks).toBe("Задачи");
    expect(uz.doctor.nav.sidebar.tasks).toBeTruthy();
  });
});

describe("texts", () => {
  const ruTexts = flatten(ru.devTasks as unknown as Tree);
  const uzTexts = flatten(uz.devTasks as unknown as Tree);

  it("ru and uz have the same keys", () => {
    expect(Object.keys(uzTexts).sort()).toEqual(Object.keys(ruTexts).sort());
    expect(Object.keys(ruTexts).length).toBeGreaterThan(60);
  });

  it("no dashes in what users read", () => {
    const withDash = [...Object.entries(ruTexts), ...Object.entries(uzTexts)].filter(([, v]) =>
      /[—–]/.test(v),
    );
    expect(withDash).toEqual([]);
  });

  it("every column, status, priority and button has a label", () => {
    for (const s of ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"]) {
      expect(ruTexts[`columns.${s}`], s).toBeTruthy();
      expect(ruTexts[`status.${s}`], s).toBeTruthy();
      expect(ruTexts[`detail.actions.${s}`], s).toBeTruthy();
    }
    for (const p of ["NORMAL", "HIGH", "URGENT"]) expect(ruTexts[`priority.${p}`], p).toBeTruthy();
    expect(ruTexts["columns.NEW"]).toBe("Новые");
    expect(ruTexts["columns.IN_PROGRESS"]).toBe("В работе");
    expect(ruTexts["columns.DONE"]).toBe("Готово");
    expect(ruTexts["detail.actions.IN_PROGRESS"]).toBe("Взять в работу");
    expect(ruTexts["detail.actions.NEW"]).toBe("Вернуть");
  });
});

describe("developer tooling and schema", () => {
  it("the console tool and its helper ship in the worker image", () => {
    const listed = read("scripts/worker-allowlist.txt")
      .split("\n")
      .map((l) => l.trim());
    expect(listed).toContain("dev-tasks.ts");
    expect(listed).toContain("_dev-tasks-cli.ts");
  });

  it("the migration creates the three tables, the enums and the counter", () => {
    const sql = read("prisma/migrations/20261003100000_dev_tasks/migration.sql");
    for (const fragment of [
      'CREATE TYPE "DevTaskStatus" AS ENUM (\'NEW\', \'IN_PROGRESS\', \'DONE\', \'CANCELLED\')',
      'CREATE TYPE "DevTaskPriority" AS ENUM (\'NORMAL\', \'HIGH\', \'URGENT\')',
      'ALTER TABLE "Clinic" ADD COLUMN     "devTaskCounter" INTEGER NOT NULL DEFAULT 0',
      'CREATE TABLE "DevTask"',
      'CREATE TABLE "DevTaskComment"',
      'CREATE TABLE "DevTaskAttachment"',
      'CREATE UNIQUE INDEX "DevTask_clinicId_number_key" ON "DevTask"("clinicId", "number")',
      '"DevTask_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE',
    ]) {
      expect(sql, fragment).toContain(fragment);
    }
    // Additive only: nothing is dropped or rewritten.
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b/);
  });
});
