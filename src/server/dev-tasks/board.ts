/**
 * Reads and wire shapes for the «Задачи» board (`/api/crm/dev-tasks`).
 *
 * The queries run on the tenant-scoped client inside the API handler, so
 * every `devTask.*` call is pinned to the caller's clinic by the Prisma
 * extension; nothing here passes a clinicId for reads. The three DevTask
 * models carry their own clinicId for that reason (no reliance on the
 * parent row for isolation).
 */
import { prisma } from "@/lib/prisma";
import {
  allowedStatusTargets,
  devTaskFileUrl,
  devTaskPermissions,
  type DevTaskCardDto,
  type DevTaskDetailDto,
  type DevTaskPriority,
  type DevTaskStatus,
  type DevTaskViewer,
} from "@/lib/dev-tasks";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Finished and cancelled tasks the board shows: the latest ones only. */
export const DEV_TASK_CLOSED_LIMIT = 50;

const PERSON_SELECT = { id: true, name: true, role: true } as const;

export const DEV_TASK_CARD_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
  startedAt: true,
  doneAt: true,
  createdById: true,
  createdBy: { select: PERSON_SELECT },
  _count: { select: { comments: true, attachments: true } },
  attachments: {
    select: { id: true },
    orderBy: { createdAt: "asc" as const },
    take: 1,
  },
} as const;

export const DEV_TASK_DETAIL_SELECT = {
  ...DEV_TASK_CARD_SELECT,
  description: true,
  attachments: {
    select: {
      id: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
  comments: {
    select: {
      id: true,
      text: true,
      createdAt: true,
      author: { select: PERSON_SELECT },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

type CardRow = {
  id: string;
  number: number;
  title: string;
  status: DevTaskStatus;
  priority: DevTaskPriority;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  doneAt: Date | null;
  createdBy: { id: string; name: string; role: string };
  _count: { comments: number; attachments: number };
  attachments: Array<{ id: string }>;
};

type DetailRow = Omit<CardRow, "attachments"> & {
  createdById: string;
  description: string;
  attachments: Array<{
    id: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    uploadedBy: { id: string; name: string };
  }>;
  comments: Array<{
    id: string;
    text: string;
    createdAt: Date;
    author: { id: string; name: string; role: string };
  }>;
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toDevTaskCard(row: CardRow): DevTaskCardDto {
  const first = row.attachments[0];
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: iso(row.startedAt),
    doneAt: iso(row.doneAt),
    createdBy: row.createdBy,
    commentCount: row._count.comments,
    attachmentCount: row._count.attachments,
    thumbUrl: first ? devTaskFileUrl(row.id, first.id, "thumb") : null,
  };
}

export function toDevTaskDetail(row: DetailRow, viewer: DevTaskViewer): DevTaskDetailDto {
  const card = toDevTaskCard({
    ...row,
    attachments: row.attachments.slice(0, 1).map((a) => ({ id: a.id })),
  });
  const can = devTaskPermissions(viewer, row);
  return {
    ...card,
    description: row.description,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      url: devTaskFileUrl(row.id, a.id),
      thumbUrl: devTaskFileUrl(row.id, a.id, "thumb"),
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
      uploadedBy: a.uploadedBy,
    })),
    comments: row.comments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt.toISOString(),
      author: c.author,
    })),
    can,
    allowedStatuses: can.manage ? [...allowedStatusTargets(row.status)] : [],
  };
}

/** `where` for a task named by its number or its id (see parseDevTaskRef). */
export function devTaskRefWhere(ref: { number: number } | { id: string }) {
  return "number" in ref ? { number: ref.number } : { id: ref.id };
}

export async function loadDevTaskDetail(
  ref: { number: number } | { id: string },
  viewer: DevTaskViewer,
  db: PrismaLike = prisma,
): Promise<DevTaskDetailDto | null> {
  const row = await db.devTask.findFirst({
    where: devTaskRefWhere(ref),
    select: DEV_TASK_DETAIL_SELECT,
  });
  return row ? toDevTaskDetail(row as DetailRow, viewer) : null;
}

/**
 * Next «#N» for the clinic: one UPDATE … RETURNING on Clinic.devTaskCounter,
 * the same race-free allocation as patient numbers. Run inside the create
 * transaction so a failed insert does not burn a number.
 */
export async function allocateDevTaskNumber(
  clinicId: string,
  db: PrismaLike = prisma,
): Promise<number> {
  const row = await db.clinic.update({
    where: { id: clinicId },
    data: { devTaskCounter: { increment: 1 } },
    select: { devTaskCounter: true },
  });
  return row.devTaskCounter;
}

/**
 * The board: every open task, the latest finished ones and, on request, the
 * latest cancelled ones; `counts` are the real per-column totals.
 */
export async function loadDevTaskBoard(
  opts: { statuses?: DevTaskStatus[]; includeCancelled?: boolean },
  db: PrismaLike = prisma,
): Promise<{ rows: DevTaskCardDto[]; counts: Record<DevTaskStatus, number> }> {
  const wanted = new Set<DevTaskStatus>(
    opts.statuses ??
      (["NEW", "IN_PROGRESS", "DONE", ...(opts.includeCancelled ? ["CANCELLED"] : [])] as DevTaskStatus[]),
  );
  const open = (["NEW", "IN_PROGRESS"] as const).filter((s) => wanted.has(s));
  const closed = (["DONE", "CANCELLED"] as const).filter((s) => wanted.has(s));

  const [openRows, closedRows, grouped] = await Promise.all([
    open.length > 0
      ? db.devTask.findMany({
          where: { status: { in: [...open] } },
          select: DEV_TASK_CARD_SELECT,
          orderBy: { number: "desc" },
        })
      : Promise.resolve([]),
    Promise.all(
      closed.map((status) =>
        db.devTask.findMany({
          where: { status },
          select: DEV_TASK_CARD_SELECT,
          orderBy:
            status === "DONE"
              ? [{ doneAt: "desc" as const }, { number: "desc" as const }]
              : [{ updatedAt: "desc" as const }, { number: "desc" as const }],
          take: DEV_TASK_CLOSED_LIMIT,
        }),
      ),
    ),
    db.devTask.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const counts: Record<DevTaskStatus, number> = {
    NEW: 0,
    IN_PROGRESS: 0,
    DONE: 0,
    CANCELLED: 0,
  };
  for (const g of grouped as Array<{ status: DevTaskStatus; _count: { _all: number } }>) {
    counts[g.status] = g._count._all;
  }
  const rows = [...openRows, ...closedRows.flat()] as CardRow[];
  return { rows: rows.map(toDevTaskCard), counts };
}

/** NEW + IN_PROGRESS: the sidebar badge. */
export async function countOpenDevTasks(db: PrismaLike = prisma): Promise<number> {
  return db.devTask.count({ where: { status: { in: ["NEW", "IN_PROGRESS"] } } });
}
