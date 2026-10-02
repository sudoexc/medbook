/**
 * Audit PT-18: «Дата посещения» filtered the registration date, with the
 * last day lost after 05:00 Tashkent.
 * Audit PT-19: the patients export dropped the search box and the period,
 * let a Telegram name «=HYPERLINK(...)» run as a formula, and wrote money in
 * тийин.
 * Audit INF-02: the export worker wrote тийин, paged over a non-unique
 * order (rows lost or repeated at page edges), ignored the screen's filters
 * (`?from=ai-rec` failed it), and left PHI files in /tmp forever.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  appointments: [] as Array<Record<string, unknown>>,
  findManyArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      // Keyset paging the way Postgres does it, over the order asked for.
      findMany: vi.fn(
        async (args: {
          orderBy: Array<Record<string, "asc" | "desc">>;
          take: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
          state.findManyArgs.push(args as never);
          const keys = args.orderBy.map((o) => Object.entries(o)[0]!);
          const sorted = [...state.appointments].sort((a, b) => {
            for (const [k, dir] of keys) {
              const av = a[k] instanceof Date ? (a[k] as Date).getTime() : (a[k] as string);
              const bv = b[k] instanceof Date ? (b[k] as Date).getTime() : (b[k] as string);
              if (av < bv) return dir === "asc" ? -1 : 1;
              if (av > bv) return dir === "asc" ? 1 : -1;
            }
            return 0;
          });
          let start = 0;
          if (args.cursor) start = sorted.findIndex((r) => r.id === args.cursor!.id) + (args.skip ?? 0);
          return sorted.slice(start, start + args.take);
        },
      ),
    },
  },
}));

import { buildPatientListWhere, VISITED_STATUSES } from "@/server/patient/list-where";
import { csvCell, moneyCell, neutralizeFormula } from "@/server/exports/csv";
import {
  appointmentExportWhere,
  periodBound,
  writeAppointmentsCsv,
} from "@/server/exports/tables";
import {
  exportFiltersOf,
  parse as parsePatientsFilters,
} from "@/app/[locale]/crm/patients/_hooks/use-patients-filters";
import { appointmentExportFilters } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-filters";

beforeEach(() => {
  state.appointments = [];
  state.findManyArgs = [];
});

describe("«Дата посещения» is the visit date, in Tashkent days, both included (PT-18)", () => {
  it("filters visits that happened, not the registration date", async () => {
    const where = await buildPatientListWhere(
      { visitedFrom: "2026-09-01", visitedTo: "2026-09-15" },
      "c1",
    );
    expect(where.createdAt).toBeUndefined();
    expect(where.appointments).toEqual({
      some: {
        status: { in: [...VISITED_STATUSES] },
        date: {
          gte: new Date("2026-09-01T00:00:00+05:00"),
          lt: new Date("2026-09-16T00:00:00+05:00"),
        },
      },
    });
    // A visit on 15.09 at 14:00 Tashkent is inside the period.
    const visit = new Date("2026-09-15T14:00:00+05:00");
    const range = (where.appointments as { some: { date: { gte: Date; lt: Date } } }).some.date;
    expect(visit >= range.gte && visit < range.lt).toBe(true);
  });

  it("a registration day keeps its whole last day; an ISO instant is used as is", async () => {
    const day = await buildPatientListWhere({ registeredFrom: "2026-09-01", registeredTo: "2026-09-15" }, "c1");
    expect(day.createdAt).toEqual({
      gte: new Date("2026-09-01T00:00:00+05:00"),
      lt: new Date("2026-09-16T00:00:00+05:00"),
    });
    const instant = await buildPatientListWhere({ registeredFrom: "2026-09-20T19:00:00.000Z" }, "c1");
    expect(instant.createdAt).toEqual({ gte: new Date("2026-09-20T19:00:00.000Z") });
  });

  it("DSAR-erased cards are on no list (PT-07)", async () => {
    expect((await buildPatientListWhere({}, "c1")).deletedAt).toBeNull();
  });

  it("the screen's «Сегменты» duplicate of «Статус» is gone", () => {
    const src = readSrc("src/app/[locale]/crm/patients/_components/patients-filters.tsx");
    expect(src).not.toContain('t("filters.labelSegments")');
    expect(src).toContain('onChange("visitedFrom"');
    expect(src).not.toContain('onChange("registeredFrom"');
  });
});

describe("the patients export is the list on screen (PT-19)", () => {
  it("carries the search box, the periods and the age range", () => {
    const state = parsePatientsFilters(
      new URLSearchParams(
        "q=Турматов&segment=ACTIVE&visitedFrom=2026-09-01&visitedTo=2026-09-15&registeredFrom=2026-01-01&ageMin=30&sort=ltv&dir=asc",
      ),
    );
    expect(exportFiltersOf(state)).toEqual({
      q: "Турматов",
      segment: "ACTIVE",
      visitedFrom: "2026-09-01",
      visitedTo: "2026-09-15",
      registeredFrom: "2026-01-01",
      ageMin: 30,
    });
  });

  it("the worker builds the same WHERE as the list, search included", async () => {
    const where = await buildPatientListWhere({ q: "Турматов", gender: "MALE" }, "c1");
    expect(where.gender).toBe("MALE");
    expect(JSON.stringify(where.AND)).toContain("Турматов");
  });

  it("an age range becomes birth dates; cards with no birth date are out", async () => {
    const now = new Date("2026-10-01T09:00:00+05:00");
    const where = await buildPatientListWhere({ ageMin: 30, ageMax: 40 }, "c1", now);
    expect(where.birthDate).toEqual({
      not: null,
      lte: new Date(Date.UTC(1996, 9, 1, 23, 59, 59, 999)),
      gt: new Date(Date.UTC(1985, 9, 1, 23, 59, 59, 999)),
    });
  });
});

describe("CSV cells (PT-19, INF-02)", () => {
  it("neutralises formulas; plain phones and amounts stay as they are", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell('=HYPERLINK("http://evil","Нажми")')).toBe(`"'=HYPERLINK(""http://evil"",""Нажми"")"`);
    expect(neutralizeFormula("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutralizeFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutralizeFormula("\tx")).toBe("'\tx");
    expect(csvCell("+998 90 123-45-67")).toBe("+998 90 123-45-67");
    expect(csvCell("-150000")).toBe("-150000");
    expect(csvCell("Иванов")).toBe("Иванов");
  });

  it("money in сум: 150 000 сум is 150000, not 15000000", () => {
    expect(moneyCell(15_000_000)).toBe("150000");
    expect(moneyCell(15_000_050)).toBe("150000.50");
    expect(moneyCell(-250_000)).toBe("-2500");
    expect(moneyCell(null)).toBe("");
  });
});

describe("appointments export (INF-02)", () => {
  it("1200 visits at the same minute: every one exported exactly once", async () => {
    const date = new Date("2026-10-01T09:00:00+05:00");
    for (let i = 0; i < 1200; i++) {
      state.appointments.push({
        id: `a${String((i * 7919) % 1200).padStart(4, "0")}`,
        date,
        status: "BOOKED",
        doctorId: `d${i % 9}`,
        patientId: `p${i}`,
        serviceId: null,
        channel: "PHONE",
        priceFinal: 15_000_000,
        createdAt: date,
      });
    }
    const out: string[] = [];
    const count = await writeAppointmentsCsv({}, (c) => out.push(c));
    expect(count).toBe(1200);
    const ids = out.slice(1).map((line) => line.split(",")[0]);
    expect(new Set(ids).size).toBe(1200);
    expect(state.findManyArgs[0]!.orderBy).toEqual([{ date: "desc" }, { id: "desc" }]);
    expect(out[1]).toContain(",150000,");
  });

  it("takes the list's filters; a stray `from=ai-rec` is no bound, not a crash", () => {
    const where = appointmentExportWhere({
      q: "Турматов",
      statuses: ["IN_PROGRESS", "COMPLETED"],
      channel: "TELEGRAM",
      unpaid: true,
      dateFrom: "ai-rec",
      dateTo: "2026-10-01",
    });
    expect(where.status).toEqual({ in: ["IN_PROGRESS", "COMPLETED"] });
    expect(where.channel).toBe("TELEGRAM");
    expect(where.payments).toEqual({ none: { status: "PAID" } });
    expect(where.date).toEqual({ lte: new Date("2026-10-01T23:59:59.999+05:00") });
    expect(JSON.stringify(where.OR)).toContain("Турматов");
    expect(periodBound("ai-rec", "from")).toBeNull();
  });

  it("the button sends «Сегодня» as today's Tashkent window and the tile as a status", () => {
    const api = {
      from: "2026-09-30T19:00:00.000Z",
      to: "2026-10-01T18:59:59.999Z",
      q: "Алиев",
      status: undefined,
    };
    // «Прибыли» counts the hall too (audit AP-21), and the file follows it.
    expect(appointmentExportFilters({ dateMode: "today", bucket: "arrived" }, api)).toEqual({
      dateFrom: api.from,
      dateTo: api.to,
      q: "Алиев",
      statuses: ["WAITING", "IN_PROGRESS", "COMPLETED"],
    });
    expect(appointmentExportFilters({ bucket: "unconfirmed" }, api).status).toBe("BOOKED");
  });
});

function readSrc(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("export files do not stay in /tmp (INF-02)", () => {
  it("a file an hour past its job, or orphaned by a restart, is swept", async () => {
    const { sweepExpiredExports, EXPORT_TTL_MS } = await import("@/server/workers/exports");
    const dir = path.join("/tmp", "exports");
    await fs.mkdir(dir, { recursive: true });
    const orphan = path.join(dir, `p5-orphan-${process.pid}.csv`);
    await fs.writeFile(orphan, "x");
    const old = new Date(Date.now() - EXPORT_TTL_MS - 60_000);
    await fs.utimes(orphan, old, old);
    const fresh = path.join(dir, `p5-fresh-${process.pid}.csv`);
    await fs.writeFile(fresh, "x");
    await sweepExpiredExports();
    await expect(fs.stat(orphan)).rejects.toThrow();
    await expect(fs.stat(fresh)).resolves.toBeTruthy();
    await fs.unlink(fresh);
  });
});
