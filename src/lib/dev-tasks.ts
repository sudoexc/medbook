/**
 * «Задачи» — the clinic's request board for the CRM developers.
 *
 * The rules live here once and are read by the API routes, the board UI (both
 * the CRM page and the doctor cabinet) and the developer's console tool
 * (scripts/dev-tasks.ts), so a button the UI shows is always one the API
 * accepts and the script cannot move a task the UI could not.
 *
 * Client-safe and pure: no server imports, no Prisma types.
 */

export const DEV_TASK_STATUSES = ["NEW", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type DevTaskStatus = (typeof DEV_TASK_STATUSES)[number];

export const DEV_TASK_PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
export type DevTaskPriority = (typeof DEV_TASK_PRIORITIES)[number];

/** The three board columns, in order. CANCELLED hides behind a filter. */
export const DEV_TASK_BOARD_COLUMNS = ["NEW", "IN_PROGRESS", "DONE"] as const;

/** What the sidebar counts as «open»: still waiting for the developers. */
export const DEV_TASK_OPEN_STATUSES: readonly DevTaskStatus[] = ["NEW", "IN_PROGRESS"];

/**
 * Who sees the board and files tasks: the owner and admins, the desk, and
 * doctors from their cabinet. Nurses and call operators are left out on
 * purpose: screenshots of CRM screens can show patient data, and they have
 * no reason to read them. SUPER_ADMIN passes every role gate at the API
 * layer (`allowSuperAdmin`), so it is not listed.
 */
export const DEV_TASK_ROLES = ["ADMIN", "RECEPTIONIST", "DOCTOR"] as const;

/** Who moves a task between columns: the owner and the developer. */
export const DEV_TASK_MANAGER_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

/** One screenshot; the request limit in nginx is 25 MB, so one per request. */
export const DEV_TASK_MAX_BYTES = 10 * 1024 * 1024;
/** The JPEG preview the browser renders next to each upload. */
export const DEV_TASK_THUMB_MAX_BYTES = 512 * 1024;
/** Screenshots per task. */
export const DEV_TASK_MAX_ATTACHMENTS = 20;
/** Screenshots one «+ Задача» dialog sends with the new task. */
export const DEV_TASK_MAX_FILES_PER_DIALOG = 10;

export const DEV_TASK_TITLE_MAX = 200;
export const DEV_TASK_DESCRIPTION_MAX = 10_000;
export const DEV_TASK_COMMENT_MAX = 5_000;

export function canSeeDevTasks(role: string | null | undefined): boolean {
  if (!role) return false;
  return role === "SUPER_ADMIN" || (DEV_TASK_ROLES as readonly string[]).includes(role);
}

export function canManageDevTasks(role: string | null | undefined): boolean {
  if (!role) return false;
  return (DEV_TASK_MANAGER_ROLES as readonly string[]).includes(role);
}

export type DevTaskViewer = { userId: string; role: string };

/**
 * Title, description, priority and screenshots: the author's own words, so
 * the author may change them; the owner and the developer may tidy anyone's.
 */
export function canEditDevTask(
  viewer: DevTaskViewer,
  task: { createdById: string },
): boolean {
  return canManageDevTasks(viewer.role) || viewer.userId === task.createdById;
}

export type DevTaskPermissions = {
  /** Change title, description, priority; add and remove screenshots. */
  edit: boolean;
  /** Move between columns. */
  manage: boolean;
  /** Comment: everyone who sees the board. */
  comment: boolean;
};

export function devTaskPermissions(
  viewer: DevTaskViewer,
  task: { createdById: string },
): DevTaskPermissions {
  return {
    edit: canEditDevTask(viewer, task),
    manage: canManageDevTasks(viewer.role),
    comment: canSeeDevTasks(viewer.role),
  };
}

/**
 * Where a task may go from each column. «Вернуть» always means back to
 * «Новые»: a task the developer took by mistake, or one the owner checked
 * and found not fixed, lands where the developer looks for new work.
 */
export const DEV_TASK_TRANSITIONS: Readonly<Record<DevTaskStatus, readonly DevTaskStatus[]>> = {
  NEW: ["IN_PROGRESS", "DONE", "CANCELLED"],
  IN_PROGRESS: ["DONE", "CANCELLED", "NEW"],
  DONE: ["NEW"],
  CANCELLED: ["NEW"],
};

export function allowedStatusTargets(from: DevTaskStatus): readonly DevTaskStatus[] {
  return DEV_TASK_TRANSITIONS[from] ?? [];
}

export type DevTaskStatusChange = {
  status: DevTaskStatus;
  startedAt: Date | null;
  doneAt: Date | null;
};

export type StatusChangePlan =
  | { ok: true; data: DevTaskStatusChange }
  | { ok: false; reason: "same_status" | "transition_not_allowed" };

/**
 * The row patch for moving a task to `to`, or why it cannot move. The
 * timestamps follow the column: «В работе» starts the clock, «Готово» stops
 * it, «Вернуть» clears both so a reopened task reads as new again.
 */
export function planStatusChange(
  task: { status: DevTaskStatus; startedAt: Date | null; doneAt: Date | null },
  to: DevTaskStatus,
  now: Date,
): StatusChangePlan {
  if (task.status === to) return { ok: false, reason: "same_status" };
  if (!allowedStatusTargets(task.status).includes(to)) {
    return { ok: false, reason: "transition_not_allowed" };
  }
  switch (to) {
    case "IN_PROGRESS":
      return { ok: true, data: { status: to, startedAt: now, doneAt: null } };
    case "DONE":
      // Done straight from «Новые» (a one-minute fix) still gets a start, so
      // «how long did it take» never reads a null.
      return {
        ok: true,
        data: { status: to, startedAt: task.startedAt ?? now, doneAt: now },
      };
    case "CANCELLED":
      return { ok: true, data: { status: to, startedAt: task.startedAt, doneAt: null } };
    case "NEW":
    default:
      return { ok: true, data: { status: "NEW", startedAt: null, doneAt: null } };
  }
}

export function isDevTaskStatus(v: unknown): v is DevTaskStatus {
  return typeof v === "string" && (DEV_TASK_STATUSES as readonly string[]).includes(v);
}

export function isDevTaskPriority(v: unknown): v is DevTaskPriority {
  return typeof v === "string" && (DEV_TASK_PRIORITIES as readonly string[]).includes(v);
}

/** 12 → «#12», the number people say out loud and type in Telegram. */
export function formatDevTaskNumber(n: number): string {
  return `#${n}`;
}

/**
 * A task as a URL or the console names it: «12» or «#12» is the per-clinic
 * number, a cuid is the row id. Anything else is not a task reference.
 */
export function parseDevTaskRef(
  raw: string | null | undefined,
): { number: number } | { id: string } | null {
  const v = (raw ?? "").trim();
  const num = /^#?(\d{1,9})$/.exec(v);
  if (num) {
    const n = Number(num[1]);
    return n > 0 ? { number: n } : null;
  }
  if (/^[a-z0-9]{10,40}$/i.test(v)) return { id: v };
  return null;
}

export type DevTaskAge =
  | { unit: "now"; value: 0 }
  | { unit: "minutes" | "hours" | "days"; value: number };

/** How long ago a task was filed, in the largest unit that reads naturally. */
export function devTaskAge(
  from: Date | string,
  now: Date = new Date(),
): DevTaskAge {
  const t = from instanceof Date ? from.getTime() : new Date(from).getTime();
  if (!Number.isFinite(t)) return { unit: "now", value: 0 };
  const minutes = Math.floor((now.getTime() - t) / 60_000);
  if (minutes < 1) return { unit: "now", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  return { unit: "days", value: Math.floor(hours / 24) };
}

const PRIORITY_RANK: Record<DevTaskPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2 };

type SortableTask = {
  status: DevTaskStatus;
  priority: DevTaskPriority;
  number: number;
  startedAt: Date | string | null;
  doneAt: Date | string | null;
  updatedAt: Date | string;
};

function ms(v: Date | string | null): number {
  if (v === null) return 0;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Order inside one column. Open work: urgent first, then the newest, so a
 * task the owner just filed is at the top of «Новые» where he looks for it.
 * Finished work: most recently finished first.
 */
export function compareDevTasks(a: SortableTask, b: SortableTask): number {
  if (a.status === "DONE" && b.status === "DONE") {
    return ms(b.doneAt) - ms(a.doneAt) || b.number - a.number;
  }
  if (a.status === "CANCELLED" && b.status === "CANCELLED") {
    return ms(b.updatedAt) - ms(a.updatedAt) || b.number - a.number;
  }
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  if (a.status === "IN_PROGRESS" && b.status === "IN_PROGRESS") {
    return ms(b.startedAt) - ms(a.startedAt) || b.number - a.number;
  }
  return b.number - a.number;
}

/** Rows split into columns (every status present), each column sorted. */
export function groupDevTasks<T extends SortableTask>(
  rows: readonly T[],
): Record<DevTaskStatus, T[]> {
  const out: Record<DevTaskStatus, T[]> = {
    NEW: [],
    IN_PROGRESS: [],
    DONE: [],
    CANCELLED: [],
  };
  for (const row of rows) out[row.status]?.push(row);
  for (const status of DEV_TASK_STATUSES) out[status].sort(compareDevTasks);
  return out;
}

/** The bucket folder of one task's screenshots. */
export function devTaskFolder(clinicId: string, taskId: string): string {
  return `clinics/${clinicId}/dev-tasks/${taskId}/`;
}

/**
 * Does `key` name a file inside this task's folder? Guards the streaming
 * route and the delete: a row can only ever lead to its own task's bytes.
 */
export function isDevTaskObjectKey(
  key: string | null | undefined,
  clinicId: string,
  taskId: string,
): boolean {
  if (!key || !clinicId || !taskId) return false;
  if (key.includes("..") || key.includes("\\") || key.includes("//")) return false;
  const folder = devTaskFolder(clinicId, taskId);
  return key.startsWith(folder) && key.length > folder.length && !key.endsWith("/");
}

export type ScreenshotProblem = "not_image" | "too_large";

/**
 * The browser-side check before a file is even offered for upload. The
 * server types the bytes again (`checkUpload`); this only spares the owner a
 * slow upload that would be refused. SVG is an image to the browser but a
 * script carrier to us, so it is refused here too. Some Android pickers
 * hand over a file with no type at all; that one goes to the server, which
 * decides by its bytes.
 */
export function screenshotProblem(file: { type: string; size: number }): ScreenshotProblem | null {
  const type = (file.type || "").toLowerCase();
  if (type && (!type.startsWith("image/") || type === "image/svg+xml")) return "not_image";
  if (file.size > DEV_TASK_MAX_BYTES) return "too_large";
  return null;
}

/**
 * HEIC / HEIF, the iPhone camera's own format. Safari draws it; Chrome and
 * Firefox do not, so a HEIC screenshot showed there as a broken image.
 * Judged by the type, or by the name when a picker gave no type.
 */
export function isHeicFile(file: { type?: string | null; name?: string | null }): boolean {
  const type = (file.type || "").toLowerCase();
  if (type) return type === "image/heic" || type === "image/heif";
  return /\.(heic|heif)$/i.test(file.name || "");
}

/** «IMG_0042.HEIC» as the JPEG it became: «IMG_0042.jpg». */
export function jpegFileName(name: string | null | undefined): string {
  const base = (name || "").trim().replace(/\.[^./\\]*$/, "");
  return `${base || "screenshot"}.jpg`;
}

/** Longest side a HEIC is redrawn at as a JPEG: a screenshot stays sharp, a 48 MP photo shrinks. */
export const DEV_TASK_HEIC_EDGE = 3000;

/**
 * Each item through `upload`, one after another (a phone on a weak network
 * finishes the first screenshot instead of stalling all of them), keeping
 * which ones failed, so the dialog can offer them again instead of losing
 * them.
 */
export async function uploadInTurn<T>(
  items: readonly T[],
  upload: (item: T) => Promise<unknown>,
  onProgress?: (done: number) => void,
): Promise<{ uploaded: T[]; failed: T[] }> {
  const uploaded: T[] = [];
  const failed: T[] = [];
  for (const item of items) {
    try {
      await upload(item);
      uploaded.push(item);
    } catch {
      failed.push(item);
    }
    onProgress?.(uploaded.length + failed.length);
  }
  return { uploaded, failed };
}

/** Longest side of the card preview the browser renders at upload. */
export const DEV_TASK_THUMB_EDGE = 480;

/**
 * Size of a preview that fits `edge` on its longest side, never upscaled
 * (a small crop stays as it is).
 */
export function fitWithin(
  width: number,
  height: number,
  edge: number = DEV_TASK_THUMB_EDGE,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** The streaming URL of a screenshot (the bucket is private). */
export function devTaskFileUrl(
  taskId: string,
  attachmentId: string,
  variant?: "thumb",
): string {
  const base = `/api/crm/dev-tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return variant === "thumb" ? `${base}?thumb=1` : base;
}

// ---------------------------------------------------------------------------
// Wire shapes: what the API returns and the board renders.
// ---------------------------------------------------------------------------

export type DevTaskPerson = { id: string; name: string; role: string };

export type DevTaskCardDto = {
  id: string;
  number: number;
  title: string;
  status: DevTaskStatus;
  priority: DevTaskPriority;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  doneAt: string | null;
  createdBy: DevTaskPerson;
  commentCount: number;
  attachmentCount: number;
  /** Preview of the first screenshot, null when the task has none. */
  thumbUrl: string | null;
};

export type DevTaskAttachmentDto = {
  id: string;
  url: string;
  thumbUrl: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; name: string };
};

export type DevTaskCommentDto = {
  id: string;
  text: string;
  createdAt: string;
  author: DevTaskPerson;
};

export type DevTaskDetailDto = DevTaskCardDto & {
  description: string;
  attachments: DevTaskAttachmentDto[];
  comments: DevTaskCommentDto[];
  /** What this viewer may do; the API enforces the same rules. */
  can: DevTaskPermissions;
  /** Columns a manager may move the task to from where it is now. */
  allowedStatuses: DevTaskStatus[];
};

export type DevTaskListDto = {
  rows: DevTaskCardDto[];
  counts: Record<DevTaskStatus, number>;
};
