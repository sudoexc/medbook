/**
 * The «Задачи» board from the server console, for the developer.
 *
 * The owner files tasks in the CRM (/crm/tasks), doctors from their cabinet;
 * this reads them and answers without opening a browser:
 *
 *   docker compose exec -T worker npx tsx scripts/dev-tasks.ts list [--all]
 *   docker compose exec -T worker npx tsx scripts/dev-tasks.ts show 12
 *   docker compose exec -T worker npx tsx scripts/dev-tasks.ts status 12 IN_PROGRESS
 *   docker compose exec -T worker npx tsx scripts/dev-tasks.ts comment 12 "Готово, проверьте"
 *
 * `list` and `show` only read. `show` prints each screenshot's object key,
 * to fetch it from MinIO (`mc cp`) when the bytes are needed outside the CRM.
 * `status` and `comment` write as the SUPER_ADMIN account (ACTOR_EMAIL, or
 * the first active one) with the same transitions the board allows
 * (`planStatusChange` in src/lib/dev-tasks.ts) and an AuditLog row each,
 * `meta.via = "scripts/dev-tasks.ts"`, so the owner sees who moved it.
 *
 * Clinic: CLINIC_SLUG (default neurofax). The raw client is used on purpose:
 * there is no request here, so every query names the clinic itself.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { AUDIT_ACTION } from "../src/lib/audit-actions";
import {
  DEV_TASK_COMMENT_MAX,
  DEV_TASK_OPEN_STATUSES,
  allowedStatusTargets,
  formatDevTaskNumber,
  planStatusChange,
} from "../src/lib/dev-tasks";
import { USAGE, formatAge, formatTaskLine, parseDevTaskCommand } from "./_dev-tasks-cli";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const VIA = "scripts/dev-tasks.ts";
const CLINIC_SLUG = process.env.CLINIC_SLUG || "neurofax";
/** Finished tasks `list` shows without --all. */
const RECENT_DONE = 10;

const LINE_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  createdAt: true,
  createdBy: { select: { name: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;

async function resolveClinic(): Promise<{ id: string; nameRu: string }> {
  const clinic = await prisma.clinic.findUnique({
    where: { slug: CLINIC_SLUG },
    select: { id: true, nameRu: true },
  });
  if (!clinic) throw new Error(`clinic «${CLINIC_SLUG}» not found (CLINIC_SLUG)`);
  return clinic;
}

async function resolveActor(): Promise<{ id: string; email: string }> {
  const email = process.env.ACTOR_EMAIL?.trim();
  const actor = await prisma.user.findFirst({
    where: { role: "SUPER_ADMIN", active: true, ...(email ? { email } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!actor) {
    throw new Error(
      email ? `no active SUPER_ADMIN with email ${email}` : "no active SUPER_ADMIN account",
    );
  }
  return actor;
}

async function findTask(clinicId: string, number: number) {
  const task = await prisma.devTask.findUnique({
    where: { clinicId_number: { clinicId, number } },
    select: {
      id: true,
      number: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      createdAt: true,
      updatedAt: true,
      startedAt: true,
      doneAt: true,
      createdBy: { select: { name: true, role: true } },
      attachments: {
        select: { objectKey: true, thumbKey: true, mimeType: true, sizeBytes: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
      comments: {
        select: { text: true, createdAt: true, author: { select: { name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!task) throw new Error(`task ${formatDevTaskNumber(number)} not found in ${CLINIC_SLUG}`);
  return task;
}

function stamp(d: Date | null): string {
  return d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "-";
}

async function list(clinicId: string, all: boolean) {
  const now = new Date();
  const [open, done, cancelled] = await Promise.all([
    prisma.devTask.findMany({
      where: { clinicId, status: { in: [...DEV_TASK_OPEN_STATUSES] } },
      select: LINE_SELECT,
      orderBy: [{ priority: "desc" }, { number: "desc" }],
    }),
    prisma.devTask.findMany({
      where: { clinicId, status: "DONE" },
      select: LINE_SELECT,
      orderBy: [{ doneAt: "desc" }, { number: "desc" }],
      ...(all ? {} : { take: RECENT_DONE }),
    }),
    all
      ? prisma.devTask.findMany({
          where: { clinicId, status: "CANCELLED" },
          select: LINE_SELECT,
          orderBy: { number: "desc" },
        })
      : Promise.resolve([]),
  ]);
  const section = (title: string, rows: typeof open) => {
    console.log(`\n${title} (${rows.length})`);
    if (rows.length === 0) console.log("  -");
    for (const row of rows) console.log(`  ${formatTaskLine(row, now)}`);
  };
  section("NEW", open.filter((t) => t.status === "NEW"));
  section("IN_PROGRESS", open.filter((t) => t.status === "IN_PROGRESS"));
  section(all ? "DONE" : `DONE (latest ${RECENT_DONE})`, done);
  if (all) section("CANCELLED", cancelled);
}

async function show(clinicId: string, number: number) {
  const task = await findTask(clinicId, number);
  const now = new Date();
  console.log(`${formatDevTaskNumber(task.number)}  ${task.title}`);
  console.log(`status    ${task.status}   priority ${task.priority}`);
  console.log(`author    ${task.createdBy.name} (${task.createdBy.role}), ${formatAge(task.createdAt, now)}`);
  console.log(`created   ${stamp(task.createdAt)}   started ${stamp(task.startedAt)}   done ${stamp(task.doneAt)}`);
  console.log(`next      ${allowedStatusTargets(task.status).join(" | ")}`);
  console.log(`\n${task.description || "(no description)"}`);
  console.log(`\nScreenshots (${task.attachments.length})`);
  for (const a of task.attachments) {
    console.log(`  ${a.objectKey}  ${a.mimeType}  ${Math.round(a.sizeBytes / 1024)} KB`);
    if (a.thumbKey) console.log(`    thumb ${a.thumbKey}`);
  }
  console.log(`\nComments (${task.comments.length})`);
  for (const c of task.comments) {
    console.log(`  ${stamp(c.createdAt)}  ${c.author.name} (${c.author.role})`);
    for (const line of c.text.split("\n")) console.log(`    ${line}`);
  }
}

async function setStatus(clinicId: string, number: number, to: Parameters<typeof planStatusChange>[1]) {
  const task = await findTask(clinicId, number);
  const plan = planStatusChange(task, to, new Date());
  if (!plan.ok) {
    throw new Error(
      `${formatDevTaskNumber(number)} is ${task.status}; ${plan.reason}. Allowed: ${allowedStatusTargets(task.status).join(", ")}`,
    );
  }
  const actor = await resolveActor();
  await prisma.$transaction(async (tx) => {
    // Conditional on the column we read, like the API: if someone moved it in
    // the CRM meanwhile, nothing is written.
    const res = await tx.devTask.updateMany({
      where: { id: task.id, clinicId, status: task.status },
      data: plan.data,
    });
    if (res.count === 0) throw new Error(`${formatDevTaskNumber(number)} changed meanwhile, run show again`);
    await tx.auditLog.create({
      data: {
        clinicId,
        action: AUDIT_ACTION.DEV_TASK_STATUS_CHANGED,
        entityType: "DevTask",
        entityId: task.id,
        meta: { number, from: task.status, to, via: VIA },
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        actorLabel: actor.email,
      },
    });
  });
  console.log(`${formatDevTaskNumber(number)}: ${task.status} → ${to}`);
}

async function comment(clinicId: string, number: number, text: string) {
  if (text.length > DEV_TASK_COMMENT_MAX) {
    throw new Error(`comment is ${text.length} characters, the limit is ${DEV_TASK_COMMENT_MAX}`);
  }
  const task = await findTask(clinicId, number);
  const actor = await resolveActor();
  await prisma.$transaction(async (tx) => {
    const row = await tx.devTaskComment.create({
      data: { clinicId, taskId: task.id, authorId: actor.id, text },
      select: { id: true },
    });
    await tx.devTask.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        clinicId,
        action: AUDIT_ACTION.DEV_TASK_COMMENTED,
        entityType: "DevTask",
        entityId: task.id,
        meta: { number, commentId: row.id, via: VIA },
        actorId: actor.id,
        actorRole: "SUPER_ADMIN",
        actorLabel: actor.email,
      },
    });
  });
  console.log(`${formatDevTaskNumber(number)}: comment added as ${actor.email}`);
}

async function main() {
  const cmd = parseDevTaskCommand(process.argv.slice(2));
  if (cmd.kind === "help") {
    if (cmd.error) console.error(`error: ${cmd.error}\n`);
    console.log(USAGE);
    process.exitCode = cmd.error ? 1 : 0;
    return;
  }
  const clinic = await resolveClinic();
  console.log(`Clinic: ${clinic.nameRu} (${CLINIC_SLUG})`);
  switch (cmd.kind) {
    case "list":
      return list(clinic.id, cmd.all);
    case "show":
      return show(clinic.id, cmd.number);
    case "status":
      return setStatus(clinic.id, cmd.number, cmd.status);
    case "comment":
      return comment(clinic.id, cmd.number, cmd.text);
  }
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? `error: ${e.message}` : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
