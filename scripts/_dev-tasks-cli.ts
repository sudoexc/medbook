/**
 * Pure half of scripts/dev-tasks.ts: argument parsing and the text it
 * prints, kept apart so tests can pin them without a database.
 */
import {
  DEV_TASK_STATUSES,
  devTaskAge,
  formatDevTaskNumber,
  isDevTaskStatus,
  type DevTaskPriority,
  type DevTaskStatus,
} from "../src/lib/dev-tasks";

export const USAGE = `Usage (in the worker container):
  npx tsx scripts/dev-tasks.ts list [--all]          open tasks + the last finished ones (--all: everything)
  npx tsx scripts/dev-tasks.ts show <n>              one task: text, screenshots (object keys), comments
  npx tsx scripts/dev-tasks.ts status <n> <STATUS>   move it: ${DEV_TASK_STATUSES.join(" | ")}
  npx tsx scripts/dev-tasks.ts comment <n> "text"    reply in the task's thread

  CLINIC_SLUG   clinic to read (default: neurofax)
  ACTOR_EMAIL   SUPER_ADMIN account that writes (default: the first active one)

list and show only read. status and comment write as the SUPER_ADMIN account
and leave an AuditLog row (meta.via = "scripts/dev-tasks.ts").`;

export type DevTaskCommand =
  | { kind: "list"; all: boolean }
  | { kind: "show"; number: number }
  | { kind: "status"; number: number; status: DevTaskStatus }
  | { kind: "comment"; number: number; text: string }
  | { kind: "help"; error?: string };

function taskNumber(raw: string | undefined): number | null {
  const m = /^#?(\d{1,9})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** `argv` without the node and script paths. */
export function parseDevTaskCommand(argv: readonly string[]): DevTaskCommand {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case "list":
      return { kind: "list", all: rest.includes("--all") };
    case "show": {
      const number = taskNumber(rest[0]);
      return number ? { kind: "show", number } : { kind: "help", error: "show needs a task number" };
    }
    case "status": {
      const number = taskNumber(rest[0]);
      if (!number) return { kind: "help", error: "status needs a task number" };
      const status = (rest[1] ?? "").trim().toUpperCase();
      if (!isDevTaskStatus(status)) {
        return { kind: "help", error: `unknown status «${rest[1] ?? ""}»` };
      }
      return { kind: "status", number, status };
    }
    case "comment": {
      const number = taskNumber(rest[0]);
      if (!number) return { kind: "help", error: "comment needs a task number" };
      const text = rest.slice(1).join(" ").trim();
      if (!text) return { kind: "help", error: "comment needs a text" };
      return { kind: "comment", number, text };
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return { kind: "help" };
    default:
      return { kind: "help", error: `unknown command «${cmd}»` };
  }
}

export function formatAge(from: Date, now: Date): string {
  const age = devTaskAge(from, now);
  switch (age.unit) {
    case "now":
      return "just now";
    case "minutes":
      return `${age.value}m ago`;
    case "hours":
      return `${age.value}h ago`;
    default:
      return `${age.value}d ago`;
  }
}

export type TaskLineInput = {
  number: number;
  title: string;
  status: DevTaskStatus;
  priority: DevTaskPriority;
  createdAt: Date;
  createdBy: { name: string };
  _count: { comments: number; attachments: number };
};

/** One line of `list`: «#12  URGENT  Title  · Author, 3d ago · 2 comments, 1 screenshot». */
export function formatTaskLine(task: TaskLineInput, now: Date): string {
  const priority = task.priority === "NORMAL" ? "" : `${task.priority}  `;
  const extras = [
    task._count.comments ? `${task._count.comments} comment${task._count.comments === 1 ? "" : "s"}` : null,
    task._count.attachments
      ? `${task._count.attachments} screenshot${task._count.attachments === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  return [
    `${formatDevTaskNumber(task.number).padEnd(6)}${priority}${task.title}`,
    `${task.createdBy.name}, ${formatAge(task.createdAt, now)}`,
    ...(extras.length ? [extras.join(", ")] : []),
  ].join("  · ");
}
