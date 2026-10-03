"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BanIcon,
  CheckIcon,
  ImageIcon,
  ImagePlusIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatClinicDateTime, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  DEV_TASK_COMMENT_MAX,
  DEV_TASK_DESCRIPTION_MAX,
  DEV_TASK_MAX_ATTACHMENTS,
  DEV_TASK_PRIORITIES,
  DEV_TASK_TITLE_MAX,
  formatDevTaskNumber,
  screenshotProblem,
  type DevTaskDetailDto,
  type DevTaskPriority,
  type DevTaskStatus,
} from "@/lib/dev-tasks";

import { DevTaskPriorityChip, DevTaskStatusChip } from "./dev-task-bits";
import { ScreenshotLightbox } from "./screenshot-lightbox";
import {
  useAddDevTaskComment,
  useDevTask,
  useRemoveDevTaskScreenshot,
  useUpdateDevTask,
  useUploadDevTaskScreenshots,
} from "./use-dev-tasks";

const STATUS_ICON: Record<DevTaskStatus, React.ComponentType<{ className?: string }>> = {
  IN_PROGRESS: PlayIcon,
  DONE: CheckIcon,
  CANCELLED: BanIcon,
  NEW: RotateCcwIcon,
};

/** Button order in the footer: the move forward first, «Вернуть» last. */
const STATUS_ORDER: DevTaskStatus[] = ["IN_PROGRESS", "DONE", "CANCELLED", "NEW"];

/**
 * One task: the full text, the screenshots (tap to enlarge), the thread
 * and, for the owner and the developer, the column buttons. A full-width
 * sheet on a phone, a side drawer on a desktop.
 */
export function DevTaskDrawer({
  taskRef,
  onClose,
}: {
  /** The task number as a string (from `?task=12`), null when closed. */
  taskRef: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("devTasks.detail");
  const tBoard = useTranslations("devTasks");
  const query = useDevTask(taskRef);
  const task = query.data;
  const notFound = query.error?.status === 404 || query.error?.status === 400;

  return (
    <Sheet
      open={taskRef !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
        showCloseButton={false}
      >
        <SheetHeader className="border-b bg-card/50 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-mono text-xs font-semibold text-muted-foreground tabular-nums">
                  {task ? formatDevTaskNumber(task.number) : taskRef ? `#${taskRef}` : ""}
                </span>
                {task ? <DevTaskStatusChip status={task.status} /> : null}
                {task ? <DevTaskPriorityChip priority={task.priority} /> : null}
              </div>
              <SheetTitle className="mt-1 text-base font-semibold [overflow-wrap:anywhere]">
                {task ? task.title : t("loading")}
              </SheetTitle>
              <SheetDescription className="sr-only">
                {task ? formatDevTaskNumber(task.number) : t("loading")}
              </SheetDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={t("close")}
              className="size-11 md:size-8"
            >
              <XIcon className="size-5 md:size-4" />
            </Button>
          </div>
        </SheetHeader>

        {query.isLoading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
        ) : notFound ? (
          <p className="p-6 text-sm text-muted-foreground">{t("notFound")}</p>
        ) : query.isError || !task ? (
          <div className="flex flex-col items-start gap-3 p-6">
            <p className="text-sm text-destructive">{t("loadError")}</p>
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              <RotateCcwIcon />
              {tBoard("retry")}
            </Button>
          </div>
        ) : (
          <DrawerBody key={task.id} task={task} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ task }: { task: DevTaskDetailDto }) {
  const t = useTranslations("devTasks.detail");
  const tStatus = useTranslations("devTasks.status");
  const tRoles = useTranslations("crmShell.topbar.roles");
  const locale = (useLocale() === "uz" ? "uz" : "ru") as Locale;
  const update = useUpdateDevTask();
  const comment = useAddDevTaskComment();
  const [editing, setEditing] = React.useState(false);
  const [lightbox, setLightbox] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");
  const threadEnd = React.useRef<HTMLDivElement>(null);
  const number = formatDevTaskNumber(task.number);

  const roleLabel = (role: string) =>
    ["SUPER_ADMIN", "ADMIN", "DOCTOR", "RECEPTIONIST", "NURSE", "CALL_OPERATOR"].includes(role)
      ? tRoles(role as "ADMIN")
      : tRoles("fallback");

  const move = (to: DevTaskStatus) =>
    update.mutate(
      { id: task.id, status: to },
      {
        onSuccess: (next) =>
          toast.success(t("statusChanged", { number, status: tStatus(next.status) })),
        onError: () => toast.error(t("statusError")),
      },
    );

  const send = () => {
    const text = draft.trim();
    if (!text || comment.isPending) return;
    comment.mutate(
      { id: task.id, text },
      {
        onSuccess: () => {
          setDraft("");
          // Keep the new reply in view on a phone, above the keyboard.
          requestAnimationFrame(() =>
            threadEnd.current?.scrollIntoView({ block: "end", behavior: "smooth" }),
          );
        },
        onError: () => toast.error(t("commentError")),
      },
    );
  };

  const statuses = STATUS_ORDER.filter((s) => task.allowedStatuses.includes(s));
  const primary = statuses.find((s) => s === "IN_PROGRESS" || s === "DONE");

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          {editing ? (
            <EditForm task={task} onDone={() => setEditing(false)} />
          ) : (
            <section className="flex flex-col gap-2">
              {task.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                  {task.description}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("noDescription")}</p>
              )}
              {task.can.edit ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(true)}
                  className="h-10 self-start md:h-7"
                >
                  <PencilIcon />
                  {t("edit")}
                </Button>
              ) : null}
            </section>
          )}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-card/40 p-3 text-xs sm:grid-cols-2">
            <div>
              <dt className="inline text-muted-foreground">{t("author")}: </dt>
              <dd className="inline text-foreground">
                {task.createdBy.name}
                <span className="text-muted-foreground"> · {roleLabel(task.createdBy.role)}</span>
              </dd>
            </div>
            <div>
              <dt className="inline text-muted-foreground">{t("created")}: </dt>
              <dd className="inline text-foreground tabular-nums">
                {formatClinicDateTime(task.createdAt, locale)}
              </dd>
            </div>
            {task.startedAt ? (
              <div>
                <dt className="inline text-muted-foreground">{t("started")}: </dt>
                <dd className="inline text-foreground tabular-nums">
                  {formatClinicDateTime(task.startedAt, locale)}
                </dd>
              </div>
            ) : null}
            {task.doneAt ? (
              <div>
                <dt className="inline text-muted-foreground">{t("done")}: </dt>
                <dd className="inline text-foreground tabular-nums">
                  {formatClinicDateTime(task.doneAt, locale)}
                </dd>
              </div>
            ) : null}
          </dl>

          <Screenshots task={task} onOpen={setLightbox} />

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {t("comments")}
              {task.comments.length > 0 ? (
                <span className="ml-1.5 text-muted-foreground tabular-nums">
                  {task.comments.length}
                </span>
              ) : null}
            </h3>
            {task.comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noComments")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {task.comments.map((c) => (
                  <li key={c.id} className="rounded-lg border border-border bg-card p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                      <span className="text-xs font-semibold text-foreground">
                        {c.author.name}
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {roleLabel(c.author.role)}
                        </span>
                      </span>
                      <time dateTime={c.createdAt} className="text-[11px] text-muted-foreground tabular-nums">
                        {formatClinicDateTime(c.createdAt, locale)}
                      </time>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-foreground [overflow-wrap:anywhere]">
                      {c.text}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div ref={threadEnd} />
          </section>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t bg-card/60 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {task.can.comment ? (
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={t("commentPlaceholder")}
              aria-label={t("commentPlaceholder")}
              title={t("sendHint")}
              maxLength={DEV_TASK_COMMENT_MAX}
              rows={2}
              className="min-h-[44px] flex-1 resize-none text-base md:text-sm"
            />
            <Button
              type="button"
              size="icon-lg"
              onClick={send}
              disabled={!draft.trim() || comment.isPending}
              aria-label={t("send")}
              className="size-11 md:size-9"
            >
              <SendIcon />
            </Button>
          </div>
        ) : null}
        {statuses.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {statuses.map((s) => {
              const Icon = STATUS_ICON[s];
              return (
                <Button
                  key={s}
                  type="button"
                  variant={s === primary ? "default" : s === "CANCELLED" ? "destructive" : "outline"}
                  onClick={() => move(s)}
                  disabled={update.isPending}
                  className={cn("h-11 flex-1 md:h-8 md:flex-none", s === primary && "basis-full sm:basis-auto")}
                >
                  <Icon className="size-4" />
                  {t(`actions.${s}`)}
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>

      <ScreenshotLightbox
        items={task.attachments}
        index={lightbox}
        onIndexChange={setLightbox}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}

function EditForm({ task, onDone }: { task: DevTaskDetailDto; onDone: () => void }) {
  const t = useTranslations("devTasks.detail");
  const tCreate = useTranslations("devTasks.create");
  const tPriority = useTranslations("devTasks.priority");
  const update = useUpdateDevTask();
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description);
  const [priority, setPriority] = React.useState<DevTaskPriority>(task.priority);
  const titleId = React.useId();
  const descriptionId = React.useId();

  const save = () => {
    if (!title.trim()) return;
    update.mutate(
      { id: task.id, title: title.trim(), description: description.trim(), priority },
      {
        onSuccess: () => {
          toast.success(t("saved"));
          onDone();
        },
        onError: () => toast.error(t("saveError")),
      },
    );
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={titleId} className="text-sm font-medium leading-none">
          {tCreate("titleLabel")}
        </label>
        <Input
          id={titleId}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={DEV_TASK_TITLE_MAX}
          required
          className="h-11 md:h-9"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionId} className="text-sm font-medium leading-none">
          {tCreate("descriptionLabel")}
        </label>
        <Textarea
          id={descriptionId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DEV_TASK_DESCRIPTION_MAX}
          rows={6}
          className="text-base md:text-sm"
        />
      </div>
      <div role="radiogroup" aria-label={tCreate("priorityLabel")} className="grid grid-cols-3 gap-1.5">
        {DEV_TASK_PRIORITIES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={priority === p}
            onClick={() => setPriority(p)}
            className={cn(
              "h-11 rounded-lg border px-2 text-sm font-medium transition-colors md:h-8",
              priority === p
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted/40",
            )}
          >
            {tPriority(p)}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={update.isPending || !title.trim()}
          className="h-11 flex-1 md:h-8 md:flex-none"
        >
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={update.isPending}
          className="h-11 flex-1 md:h-8 md:flex-none"
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function Screenshots({
  task,
  onOpen,
}: {
  task: DevTaskDetailDto;
  onOpen: (index: number) => void;
}) {
  const t = useTranslations("devTasks.detail");
  const tCreate = useTranslations("devTasks.create");
  const upload = useUploadDevTaskScreenshots();
  const remove = useRemoveDevTaskScreenshot();
  const fileInput = React.useRef<HTMLInputElement>(null);
  // Removing takes two taps (the first arms the button for a few seconds):
  // a screenshot deleted by a stray thumb on a phone cannot be undone.
  const [armed, setArmed] = React.useState<string | null>(null);
  const [broken, setBroken] = React.useState<Record<string, true>>({});
  React.useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const room = DEV_TASK_MAX_ATTACHMENTS - task.attachments.length;

  const addFiles = (files: File[]) => {
    const ok: File[] = [];
    for (const file of files) {
      const problem = screenshotProblem(file);
      if (problem === "not_image") toast.error(tCreate("notImage", { name: file.name || "file" }));
      else if (problem === "too_large") toast.error(tCreate("tooLarge", { name: file.name || "file" }));
      else ok.push(file);
    }
    if (ok.length > room) toast.error(t("limitReached", { max: DEV_TASK_MAX_ATTACHMENTS }));
    const batch = ok.slice(0, Math.max(0, room));
    if (batch.length === 0) return;
    upload.mutate(
      { taskId: task.id, files: batch },
      {
        onSuccess: (r) => {
          if (r.failed > 0) toast.error(t("uploadError"));
        },
        onError: () => toast.error(t("uploadError")),
      },
    );
  };

  const onRemove = (attachmentId: string) => {
    if (armed !== attachmentId) {
      setArmed(attachmentId);
      return;
    }
    setArmed(null);
    remove.mutate(
      { taskId: task.id, attachmentId },
      {
        onSuccess: () => toast.success(t("removed")),
        onError: () => toast.error(t("removeError")),
      },
    );
  };

  if (task.attachments.length === 0 && !task.can.edit) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("screenshots")}
        {task.attachments.length > 0 ? (
          <span className="ml-1.5 text-muted-foreground tabular-nums">{task.attachments.length}</span>
        ) : null}
      </h3>
      {task.attachments.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {task.attachments.map((a, i) => (
            <li
              key={a.id}
              className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
            >
              <button
                type="button"
                onClick={() => onOpen(i)}
                aria-label={t("screenshotAlt", { index: i + 1, total: task.attachments.length })}
                className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {broken[a.id] ? (
                  <ImageIcon className="m-auto size-6 text-muted-foreground" aria-hidden />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a session-gated stream, not a static asset
                  <img
                    src={a.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken((prev) => ({ ...prev, [a.id]: true }))}
                    className="size-full object-cover object-top"
                  />
                )}
              </button>
              {task.can.edit ? (
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  disabled={remove.isPending}
                  aria-label={t("removeScreenshot")}
                  className={cn(
                    "absolute right-1 top-1 flex size-8 items-center justify-center rounded-full shadow-sm ring-1 transition-colors",
                    armed === a.id
                      ? "bg-destructive text-destructive-foreground ring-destructive"
                      : "bg-background/90 text-foreground ring-border hover:bg-background",
                  )}
                >
                  {armed === a.id ? <Trash2Icon className="size-4" /> : <XIcon className="size-4" />}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("noScreenshots")}</p>
      )}
      {task.can.edit && room > 0 ? (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={upload.isPending}
            className="h-11 self-start md:h-8"
          >
            <ImagePlusIcon />
            {upload.isPending ? t("uploadingScreenshot") : t("addScreenshot")}
          </Button>
        </>
      ) : null}
    </section>
  );
}
