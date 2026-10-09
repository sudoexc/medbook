/**
 * «Перерыв» / «Обед» (owner request 09.10.2026): the doctor's buttons, the
 * API and his TV.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import { DOCTOR_RESUMED_SHOWN_MS, parseDoctorPauseKind } from "@/lib/doctor-pause";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("kinds", () => {
  it("break and lunch, nothing else", () => {
    expect(parseDoctorPauseKind("BREAK")).toBe("BREAK");
    expect(parseDoctorPauseKind("LUNCH")).toBe("LUNCH");
    for (const v of ["", "OFF", null, 1]) expect(parseDoctorPauseKind(v)).toBeNull();
  });
});

describe("wiring", () => {
  it("the API is the doctor's own, switches kinds, ends what is open, pokes the TV", () => {
    const start = read("src/app/api/crm/doctor-pause/route.ts");
    expect(start).toContain('roles: ["DOCTOR"], bodySchema: StartPauseSchema');
    expect(start).toContain("if (open?.kind === body.kind) return ok({ pause: open });");
    expect(start).toContain("where: { doctorId: doctor.id, endedAt: null },");
    expect(start).toContain("publishDoctorPauseChanged(ctx.clinicId, doctor.id);");
    const end = read("src/app/api/crm/doctor-pause/end/route.ts");
    expect(end).toContain("if (ended.count > 0) publishDoctorPauseChanged(ctx.clinicId, doctor.id);");
    const server = read("src/server/doctor-pause.ts");
    // A pause left open overnight ends by itself.
    expect(server).toContain("where: { doctorId, endedAt: null, startedAt: { gte: dayStart } },");
    // The public board stream carries queue.updated with the doctor only.
    expect(server).toContain('{ type: "queue.updated", payload: { doctorId } }');
  });

  it("the TV shows the pause instead of the queue, then «снова принимает» for a few seconds", () => {
    const api = read("src/app/api/tv/d/[token]/route.ts");
    expect(api).toContain("pause: pause ? { kind: pause.kind, since: pause.startedAt } : null,");
    const tv = read("src/app/tv/d/[token]/page.tsx");
    expect(tv).toMatch(/\{pause \? \(\s*<PausePanel kind=\{pause\.kind\} since=\{pause\.since\} \/>\s*\) : resumed \? \(\s*<ResumedPanel \/>/);
    expect(tv).toContain("setTimeout(() => setResumed(false), DOCTOR_RESUMED_SHOWN_MS)");
    expect(DOCTOR_RESUMED_SHOWN_MS).toBeGreaterThanOrEqual(3_000);
  });

  it("the doctor's top bar has the buttons", () => {
    expect(read("src/app/[locale]/doctor/_components/doctor-topbar.tsx")).toContain("<DoctorPauseButtons />");
  });

  it("the migration is additive", () => {
    const sql = read("prisma/migrations/20261009110000_doctor_pauses/migration.sql");
    expect(sql).toContain('CREATE TABLE "DoctorPause"');
    expect(sql).not.toMatch(/DROP|ALTER TABLE "(?!DoctorPause)/);
  });

  it("texts in both languages, no dashes", () => {
    expect(Object.keys(uz.doctorPause).sort()).toEqual(Object.keys(ru.doctorPause).sort());
    expect(Object.keys(uz.tvBoard.doctorBoard.pause).sort()).toEqual(
      Object.keys(ru.tvBoard.doctorBoard.pause).sort(),
    );
    for (const m of [ru, uz]) {
      for (const v of [...Object.values(m.doctorPause), ...Object.values(m.tvBoard.doctorBoard.pause)]) {
        expect(v).not.toMatch(/[—–]/);
      }
    }
  });
});
