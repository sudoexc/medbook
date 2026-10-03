/**
 * «Задачи» board: the pure rules shared by the API, the board UI and the
 * developer's console tool (src/lib/dev-tasks.ts, scripts/_dev-tasks-cli.ts).
 *
 * Pinned here: who sees the board, who edits and who moves a task, which
 * column moves exist and what each does to the timestamps, how «#12» is
 * parsed, the card order inside a column, the screenshot folder guard and
 * the browser-side screenshot check.
 */
import { describe, expect, it } from "vitest";

import {
  DEV_TASK_MAX_BYTES,
  DEV_TASK_ROLES,
  allowedStatusTargets,
  canEditDevTask,
  canManageDevTasks,
  canSeeDevTasks,
  devTaskAge,
  devTaskFileUrl,
  devTaskFolder,
  devTaskPermissions,
  fitWithin,
  formatDevTaskNumber,
  groupDevTasks,
  isDevTaskObjectKey,
  parseDevTaskRef,
  planStatusChange,
  screenshotProblem,
  type DevTaskPriority,
  type DevTaskStatus,
} from "@/lib/dev-tasks";
import {
  formatTaskLine,
  parseDevTaskCommand,
} from "../../scripts/_dev-tasks-cli";

describe("who sees, edits and moves tasks", () => {
  it("the board is for the owner, the desk and doctors, not nurses or call operators", () => {
    expect(DEV_TASK_ROLES).toEqual(["ADMIN", "RECEPTIONIST", "DOCTOR"]);
    for (const role of ["ADMIN", "SUPER_ADMIN", "RECEPTIONIST", "DOCTOR"]) {
      expect(canSeeDevTasks(role), role).toBe(true);
    }
    for (const role of ["NURSE", "CALL_OPERATOR", "", null, undefined]) {
      expect(canSeeDevTasks(role), String(role)).toBe(false);
    }
  });

  it("only ADMIN and SUPER_ADMIN move tasks between columns", () => {
    expect(canManageDevTasks("ADMIN")).toBe(true);
    expect(canManageDevTasks("SUPER_ADMIN")).toBe(true);
    for (const role of ["RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR", null]) {
      expect(canManageDevTasks(role), String(role)).toBe(false);
    }
  });

  it("the author edits his own task; managers edit anyone's; others only comment", () => {
    const task = { createdById: "u_doc" };
    expect(canEditDevTask({ userId: "u_doc", role: "DOCTOR" }, task)).toBe(true);
    expect(canEditDevTask({ userId: "u_doc2", role: "DOCTOR" }, task)).toBe(false);
    expect(canEditDevTask({ userId: "u_desk", role: "RECEPTIONIST" }, task)).toBe(false);
    expect(canEditDevTask({ userId: "u_admin", role: "ADMIN" }, task)).toBe(true);
    expect(canEditDevTask({ userId: "u_sa", role: "SUPER_ADMIN" }, task)).toBe(true);

    expect(devTaskPermissions({ userId: "u_doc2", role: "DOCTOR" }, task)).toEqual({
      edit: false,
      manage: false,
      comment: true,
    });
    expect(devTaskPermissions({ userId: "u_doc", role: "DOCTOR" }, task)).toEqual({
      edit: true,
      manage: false,
      comment: true,
    });
    expect(devTaskPermissions({ userId: "u_admin", role: "ADMIN" }, task)).toEqual({
      edit: true,
      manage: true,
      comment: true,
    });
  });
});

describe("column moves", () => {
  const now = new Date("2026-10-03T10:00:00Z");
  const earlier = new Date("2026-10-01T08:00:00Z");

  it("each column offers the buttons the drawer shows", () => {
    expect(allowedStatusTargets("NEW")).toEqual(["IN_PROGRESS", "DONE", "CANCELLED"]);
    expect(allowedStatusTargets("IN_PROGRESS")).toEqual(["DONE", "CANCELLED", "NEW"]);
    // «Вернуть» from a finished or cancelled task goes back to «Новые».
    expect(allowedStatusTargets("DONE")).toEqual(["NEW"]);
    expect(allowedStatusTargets("CANCELLED")).toEqual(["NEW"]);
  });

  it("«Взять в работу» starts the clock", () => {
    const plan = planStatusChange({ status: "NEW", startedAt: null, doneAt: null }, "IN_PROGRESS", now);
    expect(plan).toEqual({ ok: true, data: { status: "IN_PROGRESS", startedAt: now, doneAt: null } });
  });

  it("«Готово» stops it and keeps the start; straight from «Новые» it gets one", () => {
    expect(
      planStatusChange({ status: "IN_PROGRESS", startedAt: earlier, doneAt: null }, "DONE", now),
    ).toEqual({ ok: true, data: { status: "DONE", startedAt: earlier, doneAt: now } });
    expect(planStatusChange({ status: "NEW", startedAt: null, doneAt: null }, "DONE", now)).toEqual({
      ok: true,
      data: { status: "DONE", startedAt: now, doneAt: now },
    });
  });

  it("«Вернуть» clears both stamps; «Отменить» keeps the start", () => {
    expect(
      planStatusChange({ status: "DONE", startedAt: earlier, doneAt: now }, "NEW", now),
    ).toEqual({ ok: true, data: { status: "NEW", startedAt: null, doneAt: null } });
    expect(
      planStatusChange({ status: "IN_PROGRESS", startedAt: earlier, doneAt: null }, "CANCELLED", now),
    ).toEqual({ ok: true, data: { status: "CANCELLED", startedAt: earlier, doneAt: null } });
  });

  it("refuses the same column and moves the board has no button for", () => {
    expect(planStatusChange({ status: "NEW", startedAt: null, doneAt: null }, "NEW", now)).toEqual({
      ok: false,
      reason: "same_status",
    });
    expect(
      planStatusChange({ status: "DONE", startedAt: earlier, doneAt: now }, "IN_PROGRESS", now),
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
    expect(
      planStatusChange({ status: "CANCELLED", startedAt: null, doneAt: null }, "DONE", now),
    ).toEqual({ ok: false, reason: "transition_not_allowed" });
  });
});

describe("task numbers and references", () => {
  it("prints «#12»", () => {
    expect(formatDevTaskNumber(12)).toBe("#12");
  });

  it("reads «12» and «#12» as the number, a cuid as the id, anything else as nothing", () => {
    expect(parseDevTaskRef("12")).toEqual({ number: 12 });
    expect(parseDevTaskRef(" #7 ")).toEqual({ number: 7 });
    expect(parseDevTaskRef("cmabc123def456ghi")).toEqual({ id: "cmabc123def456ghi" });
    for (const bad of ["0", "#0", "-3", "1.5", "", null, undefined, "../etc", "a b", "x".repeat(41)]) {
      expect(parseDevTaskRef(bad as string), String(bad)).toBeNull();
    }
  });

  it("builds the streaming URL of a screenshot and its preview", () => {
    expect(devTaskFileUrl("t1", "a1")).toBe("/api/crm/dev-tasks/t1/attachments/a1");
    expect(devTaskFileUrl("t1", "a1", "thumb")).toBe("/api/crm/dev-tasks/t1/attachments/a1?thumb=1");
  });
});

describe("age on the card", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  it("picks the largest unit that reads naturally", () => {
    expect(devTaskAge(new Date("2026-10-03T11:59:40Z"), now)).toEqual({ unit: "now", value: 0 });
    expect(devTaskAge(new Date("2026-10-03T11:15:00Z"), now)).toEqual({ unit: "minutes", value: 45 });
    expect(devTaskAge("2026-10-03T07:00:00Z", now)).toEqual({ unit: "hours", value: 5 });
    expect(devTaskAge("2026-09-30T11:00:00Z", now)).toEqual({ unit: "days", value: 3 });
    expect(devTaskAge("not a date", now)).toEqual({ unit: "now", value: 0 });
  });
});

describe("order inside a column", () => {
  const row = (
    number: number,
    status: DevTaskStatus,
    priority: DevTaskPriority,
    extra: Partial<{ startedAt: string; doneAt: string; updatedAt: string }> = {},
  ) => ({
    number,
    status,
    priority,
    startedAt: extra.startedAt ?? null,
    doneAt: extra.doneAt ?? null,
    updatedAt: extra.updatedAt ?? "2026-10-01T00:00:00Z",
  });

  it("open work: urgent first, then the newest; finished: latest finished first", () => {
    const grouped = groupDevTasks([
      row(1, "NEW", "NORMAL"),
      row(2, "NEW", "URGENT"),
      row(3, "NEW", "NORMAL"),
      row(4, "NEW", "HIGH"),
      row(5, "IN_PROGRESS", "NORMAL", { startedAt: "2026-10-02T10:00:00Z" }),
      row(6, "IN_PROGRESS", "NORMAL", { startedAt: "2026-10-03T10:00:00Z" }),
      row(7, "DONE", "URGENT", { doneAt: "2026-10-01T10:00:00Z" }),
      row(8, "DONE", "NORMAL", { doneAt: "2026-10-02T10:00:00Z" }),
      row(9, "CANCELLED", "NORMAL", { updatedAt: "2026-10-02T00:00:00Z" }),
    ]);
    expect(grouped.NEW.map((r) => r.number)).toEqual([2, 4, 3, 1]);
    expect(grouped.IN_PROGRESS.map((r) => r.number)).toEqual([6, 5]);
    expect(grouped.DONE.map((r) => r.number)).toEqual([8, 7]);
    expect(grouped.CANCELLED.map((r) => r.number)).toEqual([9]);
  });

  it("every column exists even when empty", () => {
    expect(groupDevTasks([])).toEqual({ NEW: [], IN_PROGRESS: [], DONE: [], CANCELLED: [] });
  });
});

describe("screenshot storage guard", () => {
  it("a key counts only inside its own task's folder of its own clinic", () => {
    const folder = devTaskFolder("c1", "t1");
    expect(folder).toBe("clinics/c1/dev-tasks/t1/");
    expect(isDevTaskObjectKey(`${folder}abc.png`, "c1", "t1")).toBe(true);
    expect(isDevTaskObjectKey(`${folder}abc-thumb.jpg`, "c1", "t1")).toBe(true);
    for (const key of [
      "clinics/c2/dev-tasks/t1/abc.png", // another clinic
      "clinics/c1/dev-tasks/t2/abc.png", // another task
      "clinics/c1/documents/abc.png", // a patient document
      `${folder}`, // the folder itself
      `${folder}../../documents/x.pdf`,
      `${folder}sub//x.png`,
      null,
      "",
    ]) {
      expect(isDevTaskObjectKey(key, "c1", "t1"), String(key)).toBe(false);
    }
  });
});

describe("browser-side screenshot check", () => {
  it("lets images through and stops script carriers, other files and big ones", () => {
    expect(screenshotProblem({ type: "image/png", size: 1000 })).toBeNull();
    expect(screenshotProblem({ type: "image/heic", size: 1000 })).toBeNull();
    // No type at all (some Android pickers): the server decides by bytes.
    expect(screenshotProblem({ type: "", size: 1000 })).toBeNull();
    expect(screenshotProblem({ type: "image/svg+xml", size: 1000 })).toBe("not_image");
    expect(screenshotProblem({ type: "application/pdf", size: 1000 })).toBe("not_image");
    expect(screenshotProblem({ type: "text/html", size: 1000 })).toBe("not_image");
    expect(screenshotProblem({ type: "image/png", size: DEV_TASK_MAX_BYTES })).toBeNull();
    expect(screenshotProblem({ type: "image/png", size: DEV_TASK_MAX_BYTES + 1 })).toBe("too_large");
  });

  it("sizes the card preview to the long edge, never upscaling", () => {
    expect(fitWithin(1290, 2796)).toEqual({ width: 221, height: 480 });
    expect(fitWithin(2796, 1290)).toEqual({ width: 480, height: 221 });
    expect(fitWithin(300, 200)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
  });
});

describe("console tool arguments (scripts/dev-tasks.ts)", () => {
  it("parses the four commands", () => {
    expect(parseDevTaskCommand(["list"])).toEqual({ kind: "list", all: false });
    expect(parseDevTaskCommand(["list", "--all"])).toEqual({ kind: "list", all: true });
    expect(parseDevTaskCommand(["show", "#12"])).toEqual({ kind: "show", number: 12 });
    expect(parseDevTaskCommand(["status", "12", "in_progress"])).toEqual({
      kind: "status",
      number: 12,
      status: "IN_PROGRESS",
    });
    expect(parseDevTaskCommand(["comment", "12", "Готово,", "проверьте"])).toEqual({
      kind: "comment",
      number: 12,
      text: "Готово, проверьте",
    });
  });

  it("answers usage, with the reason, instead of guessing", () => {
    expect(parseDevTaskCommand([])).toEqual({ kind: "help" });
    expect(parseDevTaskCommand(["status", "12", "CLOSED"])).toMatchObject({ kind: "help", error: expect.stringContaining("CLOSED") });
    expect(parseDevTaskCommand(["show"])).toMatchObject({ kind: "help", error: expect.any(String) });
    expect(parseDevTaskCommand(["comment", "12"])).toMatchObject({ kind: "help", error: expect.any(String) });
    expect(parseDevTaskCommand(["delete", "12"])).toMatchObject({ kind: "help", error: expect.any(String) });
  });

  it("prints one line per task", () => {
    const line = formatTaskLine(
      {
        number: 12,
        title: "Не печатается заключение",
        status: "NEW",
        priority: "URGENT",
        createdAt: new Date("2026-10-01T12:00:00Z"),
        createdBy: { name: "Султонов М." },
        _count: { comments: 2, attachments: 1 },
      },
      new Date("2026-10-03T12:00:00Z"),
    );
    expect(line).toBe("#12   URGENT  Не печатается заключение  · Султонов М., 2d ago  · 2 comments, 1 screenshot");
  });
});
