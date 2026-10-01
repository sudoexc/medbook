/**
 * Audit G1-10: on «Журнал аудита» rows were drawn over each other (a fixed
 * 72 px slot for a row with meta), a failed request read «ничего не
 * найдено», filters took raw ids only, there was no object filter and no way
 * from the card to its log, and the meta was cut at 1000 characters.
 *
 * Pinned: the API filters the events of one patient (the card's own rows
 * and rows whose meta names it), pages without losing a row, the screen
 * measures its rows, shows errors with a retry, offers the patient / staff
 * / object filters and the full meta, and the card links to its log.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  findManyArgs: [] as Array<Record<string, unknown>>,
  rows: [] as Array<{ id: string }>,
}));

vi.mock("@/lib/api-handler", () => ({
  createApiListHandler:
    (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({ request, ctx: { kind: "TENANT", clinicId: "c1", userId: "a1", role: "ADMIN" } }),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(async (args: Record<string, unknown> & { take: number }) => {
        state.findManyArgs.push(args);
        return state.rows.slice(0, args.take);
      }),
    },
    patientView: {
      findMany: vi.fn(async (args: Record<string, unknown> & { take: number }) => {
        state.findManyArgs.push(args);
        return state.rows.slice(0, args.take).map((r) => ({ ...r, patientId: "p1" }));
      }),
    },
    patient: { findMany: vi.fn(async () => []) },
  },
}));

import { GET as listAudit } from "@/app/api/crm/audit/route";
import { GET as listViews } from "@/app/api/crm/audit/patient-views/route";
import { patientAuditHref } from "@/lib/audit-links";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

beforeEach(() => {
  state.findManyArgs = [];
  state.rows = Array.from({ length: 4 }, (_, i) => ({ id: `r${i}` }));
});

describe("the audit API", () => {
  it("«Журнал по пациенту»: the card's own rows and rows whose meta names it", async () => {
    await listAudit(new Request("https://x/api/crm/audit?patientId=p1&limit=10"));
    expect(state.findManyArgs[0]!.where).toMatchObject({
      clinicId: "c1",
      OR: [{ entityId: "p1" }, { meta: { path: ["patientId"], equals: "p1" } }],
    });
  });

  it("pages over a unique order with the last SENT row as the cursor", async () => {
    const res = await listAudit(new Request("https://x/api/crm/audit?limit=3"));
    const body = (await res.json()) as { rows: Array<{ id: string }>; nextCursor: string };
    expect(body.rows.map((r) => r.id)).toEqual(["r0", "r1", "r2"]);
    expect(body.nextCursor).toBe("r2");
    expect(state.findManyArgs[0]!.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);

    const views = await listViews(new Request("https://x/api/crm/audit/patient-views?limit=3"));
    expect(((await views.json()) as { nextCursor: string }).nextCursor).toBe("r2");
    expect(state.findManyArgs[1]!.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });
});

describe("the audit screen", () => {
  const src = read("src/app/[locale]/crm/settings/audit/_components/audit-log-client.tsx");

  it("measures its rows instead of a fixed slot", () => {
    expect(src.match(/ref=\{virtualizer\.measureElement\}/g)?.length).toBe(2);
    expect(src.match(/data-index=\{vi\.index\}/g)?.length).toBe(2);
  });

  it("says a failed request failed, with a retry, on both tabs", () => {
    expect(src.match(/query\.isError && rows\.length === 0/g)?.length).toBe(2);
    expect(src).toContain('t("audit.loadError")');
    expect(src).toContain('t("audit.retry")');
  });

  it("filters by patient, staff and object, and shows the full meta", () => {
    expect(src).toContain("<AuditPatientPicker");
    expect(src).toContain("<AuditStaffSelect");
    expect(src).toContain('params.set("entityId"');
    expect(src).toContain('params.set("patientId"');
    expect(src).not.toContain(".slice(0, 1000)");
    expect(src).not.toContain('placeholder="patientId"');
  });

  it("the card links to its patient's log on both tabs", () => {
    expect(patientAuditHref("ru", "p 1")).toBe(
      "/ru/crm/settings/audit?e_patientId=p%201&pv_patientId=p%201",
    );
    expect(
      read("src/app/[locale]/crm/patients/[id]/_components/patient-hero.tsx"),
    ).toContain('tp("menuAudit")');
  });
});
