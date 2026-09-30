/**
 * Audit AN-27 — the «Экспорт» button and the export API agree on who may
 * export, and every answer of the API reaches the person.
 *
 * Audit UX-09 — the Action Center's quick actions open working screens:
 * `segment=dormant` made the patients list fail with a 400.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EXPORT_ROLES, canExport } from "@/lib/export-roles";
import { EXPORT_POLL_TIMEOUT_MS, exportErrorCode } from "@/hooks/use-async-export";
import { parse as parsePatientsFilters } from "@/app/[locale]/crm/patients/_hooks/use-patients-filters";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("export access", () => {
  it("only the roles the API lets in see the button", () => {
    expect(canExport("ADMIN")).toBe(true);
    expect(canExport("SUPER_ADMIN")).toBe(true);
    for (const role of ["RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR", null]) {
      expect(canExport(role)).toBe(false);
    }
  });

  it("the API routes gate on the same list", () => {
    expect([...EXPORT_ROLES]).toEqual(["ADMIN"]);
    for (const route of [
      "src/app/api/crm/exports/route.ts",
      "src/app/api/crm/exports/[jobId]/route.ts",
      "src/app/api/crm/exports/[jobId]/download/route.ts",
    ]) {
      expect(read(route)).toContain("roles: [...EXPORT_ROLES]");
    }
  });

  it("both buttons hide for other roles and toast the API's answer", () => {
    for (const button of [
      "src/app/[locale]/crm/patients/_components/export-button.tsx",
      "src/app/[locale]/crm/appointments/_components/export-button.tsx",
    ]) {
      const src = read(button);
      expect(src).toContain("if (!canExport(role)) return null;");
      expect(src).toContain("useAsyncExportToasts(status, error)");
      // The old optimistic «поставлено в очередь» fired before any answer.
      expect(src).not.toContain('toast.message(tx("enqueued"))');
    }
  });

  it("maps the API's answers to what the person reads", () => {
    expect(exportErrorCode(403, "x")).toBe("forbidden");
    // The job registry is in memory: a restart loses the job.
    expect(exportErrorCode(404, "x")).toBe("lost");
    expect(exportErrorCode(500, "HTTP 500")).toBe("HTTP 500");
    // A job never finishing ends too, instead of spinning forever.
    expect(EXPORT_POLL_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("patients list segment filter", () => {
  it("accepts the Action Center's lowercase segment instead of failing the list", () => {
    expect(parsePatientsFilters(new URLSearchParams("segment=dormant")).segment).toBe(
      "DORMANT",
    );
    expect(parsePatientsFilters(new URLSearchParams("segment=ACTIVE")).segment).toBe(
      "ACTIVE",
    );
  });

  it("drops an unknown segment rather than sending it to the API", () => {
    expect(parsePatientsFilters(new URLSearchParams("segment=sleepy")).segment).toBeUndefined();
  });
});

describe("Action Center quick actions", () => {
  const client = read("src/app/[locale]/crm/action-center/_components/action-center-client.tsx");

  // Review of UX-09: the dormant segment list filters on the stored
  // `Patient.segment`, which nothing recalculates (PT-15), so it was always
  // empty while the hint counted patients without a visit for 90 days.
  it("reactivation opens the wizard that counts the hint's patients, for whoever can launch it", () => {
    expect(client).toContain('const REACTIVATION_HREF = "/crm/notifications/campaigns/new";');
    expect(client).not.toContain("/crm/patients/segments/dormant");
    expect(client).not.toContain("/crm/patients?segment=dormant");
    // The quick tile and the AI hint both, and only for an admin (the
    // campaign launch is ADMIN-only, like the DORMANT_BATCH task).
    expect(client.match(/REACTIVATION_HREF/g)!.length).toBeGreaterThanOrEqual(3);
    expect(client.match(/\.\.\.\(canReactivate\s*\?/g)).toHaveLength(2);
    expect(client.match(/canReactivate=\{isAdmin\}/g)).toHaveLength(2);
  });

  it("the dormant segment page offers the Call Center only on a plan that has it", () => {
    const view = read("src/app/[locale]/crm/patients/segments/_components/segment-view.tsx");
    expect(view).toContain('segment === "dormant" && hasCallCenter');
    const page = read("src/app/[locale]/crm/patients/segments/dormant/page.tsx");
    expect(page).toContain("hasCallCenter={flags.hasCallCenter}");
  });

  it("the Telegram broadcast opens the broadcast dialog, for whoever can broadcast", () => {
    expect(client).not.toContain("compose=telegram");
    expect(client).toContain("/crm/telegram?compose=broadcast");
    expect(client).toMatch(/\.\.\.\(canBroadcast\s*\?/);
    const tg = read("src/app/[locale]/crm/telegram/_components/telegram-page-client.tsx");
    expect(tg).toContain('composeParam !== "broadcast"');
  });

  it("every quick link keeps the locale", () => {
    const grid = client.slice(
      client.indexOf("function QuickActionsGrid"),
      client.indexOf("function TodayLosses"),
    );
    const hrefs = [...grid.matchAll(/href: ([^,\n]+)/g)].map((m) => m[1]!);
    expect(hrefs.length).toBeGreaterThanOrEqual(4);
    for (const href of hrefs) {
      expect(href.includes("${locale}") || href.includes("#risk-today"), href).toBe(true);
    }
  });
});
