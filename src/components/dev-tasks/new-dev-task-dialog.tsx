"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangleIcon, ImageIcon, ImagePlusIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEV_TASK_DESCRIPTION_MAX,
  DEV_TASK_MAX_FILES_PER_DIALOG,
  DEV_TASK_PRIORITIES,
  DEV_TASK_TITLE_MAX,
  formatDevTaskNumber,
  screenshotProblem,
  type DevTaskDetailDto,
  type DevTaskPriority,
} from "@/lib/dev-tasks";

import { useCreateDevTask, useUploadDevTaskScreenshots } from "./use-dev-tasks";

type Picked = { key: string; file: File; url: string };

let pickedSeq = 0;

/**
 * Picked or pasted files as previews, refusing what is not an image or is
 * too big with a toast naming the file, and stopping at the per-dialog cap.
 */
export function usePickedScreenshots(max: number) {
  const t = useTranslations("devTasks.create");
  const [picked, setPicked] = React.useState<Picked[]>([]);
  // Mirror of `picked` that every change writes synchronously, so two
  // pastes in the same tick both see the cap and the unmount cleanup sees
  // the last list.
  const pickedRef = React.useRef<Picked[]>([]);
  const commit = React.useCallback((next: Picked[]) => {
    pickedRef.current = next;
    setPicked(next);
  }, []);

  // Object URLs live until removed or the component goes away.
  React.useEffect(
    () => () => {
      for (const p of pickedRef.current) URL.revokeObjectURL(p.url);
    },
    [],
  );

  const add = React.useCallback(
    (files: Iterable<File>) => {
      const accepted: Picked[] = [];
      let room = max - pickedRef.current.length;
      for (const file of files) {
        const problem = screenshotProblem(file);
        if (problem === "not_image") {
          toast.error(t("notImage", { name: file.name || "file" }));
          continue;
        }
        if (problem === "too_large") {
          toast.error(t("tooLarge", { name: file.name || "file" }));
          continue;
        }
        if (room <= 0) {
          toast.error(t("tooMany", { max }));
          break;
        }
        room -= 1;
        pickedSeq += 1;
        accepted.push({ key: `p${pickedSeq}`, file, url: URL.createObjectURL(file) });
      }
      if (accepted.length > 0) commit([...pickedRef.current, ...accepted]);
    },
    [commit, max, t],
  );

  const remove = React.useCallback(
    (key: string) => {
      const gone = pickedRef.current.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      commit(pickedRef.current.filter((p) => p.key !== key));
    },
    [commit],
  );

  const clear = React.useCallback(() => {
    for (const p of pickedRef.current) URL.revokeObjectURL(p.url);
    commit([]);
  }, [commit]);

  /** Keeps only the files in `keep` (the uploads that failed), in order. */
  const retain = React.useCallback(
    (keep: ReadonlySet<string>) => {
      for (const p of pickedRef.current) if (!keep.has(p.key)) URL.revokeObjectURL(p.url);
      commit(pickedRef.current.filter((p) => keep.has(p.key)));
    },
    [commit],
  );

  return { picked, add, remove, clear, retain };
}

/** Images on the clipboard of a paste event (a screenshot copied on desktop). */
export function pastedImages(e: ClipboardEvent): File[] {
  const files = Array.from(e.clipboardData?.files ?? []);
  return files.filter((f) => f.type.startsWith("image/"));
}

/**
 * «+ Задача»: title, details, urgency and screenshots. The task is created
 * first, then each screenshot goes up on its own request, so one failed
 * upload never loses the text the owner typed on his phone.
 *
 * Screenshots that fail stay in the dialog with «Повторить» (they used to
 * be dropped with a toast, and the owner had to find them on his phone
 * again). The task exists by then: the text is locked, a retry uploads
 * into it, and closing the dialog opens the task.
 */
export function NewDevTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (task: DevTaskDetailDto) => void;
}) {
  const t = useTranslations("devTasks.create");
  const tPriority = useTranslations("devTasks.priority");
  const create = useCreateDevTask();
  const upload = useUploadDevTaskScreenshots();
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<DevTaskPriority>("NORMAL");
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  // The task, once created while some of its screenshots failed to upload.
  const [created, setCreated] = React.useState<DevTaskDetailDto | null>(null);
  const [broken, setBroken] = React.useState<Record<string, true>>({});
  const { picked, add, remove, clear, retain } = usePickedScreenshots(
    DEV_TASK_MAX_FILES_PER_DIALOG,
  );
  const fileInput = React.useRef<HTMLInputElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  const busy = create.isPending || upload.isPending;

  // Ctrl+V of a screenshot anywhere in the open dialog. Plain text pastes
  // into the fields as usual: only clipboard images are taken over.
  React.useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const images = pastedImages(e);
      if (images.length === 0) return;
      e.preventDefault();
      add(images);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, add]);

  const reset = () => {
    setTitle("");
    setDescription("");
    setPriority("NORMAL");
    setProgress(null);
    setCreated(null);
    setBroken({});
    clear();
  };

  const finish = (task: DevTaskDetailDto) => {
    reset();
    onOpenChange(false);
    onCreated?.(task);
  };

  /** Uploads every picked file into `task`; the keys of those that failed. */
  const uploadPicked = async (task: DevTaskDetailDto): Promise<Set<string>> => {
    const list = picked;
    setProgress({ done: 0, total: list.length });
    const result = await upload.mutateAsync({
      taskId: task.id,
      files: list.map((p) => p.file),
      onProgress: (done) => setProgress({ done, total: list.length }),
    });
    setProgress(null);
    const failed = new Set(result.failedFiles);
    return new Set(list.filter((p) => failed.has(p.file)).map((p) => p.key));
  };

  const submit = async () => {
    if (busy) return;
    // «Повторить»: the task exists, only its failed screenshots go up.
    if (created) {
      const number = formatDevTaskNumber(created.number);
      if (picked.length === 0) {
        finish(created);
        return;
      }
      const failed = await uploadPicked(created);
      if (failed.size === 0) {
        toast.success(t("created", { number }));
        finish(created);
        return;
      }
      retain(failed);
      toast.error(t("retryFailed", { failed: failed.size }), { id: "dev-task-upload" });
      return;
    }
    if (!title.trim()) return;
    let task: DevTaskDetailDto;
    try {
      task = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        priority,
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      toast.error(status === 429 ? t("rateLimited") : t("createError"));
      return;
    }
    const number = formatDevTaskNumber(task.number);
    if (picked.length === 0) {
      toast.success(t("created", { number }));
      finish(task);
      return;
    }
    const failed = await uploadPicked(task);
    if (failed.size === 0) {
      toast.success(t("created", { number }));
      finish(task);
      return;
    }
    // Keep the dialog on the files that did not go up.
    setCreated(task);
    retain(failed);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never drop the form half-sent: the upload loop is still running.
        if (!next && busy) return;
        // Closing after a partial upload: the task exists, open it.
        if (!next && created) {
          finish(created);
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3 pr-12">
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <form
          id="new-dev-task"
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {created ? (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-sm text-foreground"
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden />
              <p className="min-w-0 break-words">
                {t("uploadFailedNotice", { number: formatDevTaskNumber(created.number) })}
              </p>
            </div>
          ) : null}
          {/* The text is the created task's now: a retry only uploads. */}
          <fieldset disabled={Boolean(created)} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>{t("titleLabel")}</Label>
              <Input
                id={titleId}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                maxLength={DEV_TASK_TITLE_MAX}
                required
                autoFocus
                className="h-11 md:h-9"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor={descriptionId}>{t("descriptionLabel")}</Label>
              <Textarea
                id={descriptionId}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("descriptionPlaceholder")}
                maxLength={DEV_TASK_DESCRIPTION_MAX}
                rows={5}
                className="text-base md:text-sm"
              />
            </div>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium leading-none">{t("priorityLabel")}</legend>
              <div role="radiogroup" aria-label={t("priorityLabel")} className="grid grid-cols-3 gap-1.5">
                {DEV_TASK_PRIORITIES.map((p) => {
                  const active = priority === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setPriority(p)}
                      className={cn(
                        "h-11 rounded-lg border px-2 text-sm font-medium transition-colors md:h-9",
                        active
                          ? p === "URGENT"
                            ? "border-destructive/50 bg-destructive/10 text-destructive"
                            : p === "HIGH"
                              ? "border-warning/60 bg-warning/15 text-warning-text"
                              : "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                      )}
                    >
                      {tPriority(p)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </fieldset>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-none">{t("screenshotsLabel")}</span>
            {picked.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {picked.map((p) => (
                  <li
                    key={p.key}
                    className={cn(
                      "relative aspect-square overflow-hidden rounded-lg border bg-muted",
                      created ? "border-destructive/60" : "border-border",
                    )}
                  >
                    {broken[p.key] ? (
                      // A HEIC this browser cannot draw: named, not a broken
                      // image. It still goes up, as a JPEG where possible.
                      <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center">
                        <ImageIcon className="size-5 text-muted-foreground" aria-hidden />
                        <span className="line-clamp-2 break-all text-[11px] leading-tight text-muted-foreground">
                          {p.file.name || t("noPreview")}
                        </span>
                      </span>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview
                      <img
                        src={p.url}
                        alt={p.file.name}
                        onError={() => setBroken((prev) => ({ ...prev, [p.key]: true }))}
                        className="size-full object-cover object-top"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => remove(p.key)}
                      disabled={busy}
                      aria-label={t("removeScreenshot")}
                      className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-background"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) add(Array.from(e.target.files));
                // The same file picked again must fire onChange again.
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy || picked.length >= DEV_TASK_MAX_FILES_PER_DIALOG}
              className="h-11 w-full sm:w-auto sm:self-start md:h-9"
            >
              <ImagePlusIcon />
              {t("addScreenshots")}
            </Button>
            <p className="hidden text-xs text-muted-foreground md:block">{t("pasteHint")}</p>
          </div>
        </form>

        <DialogFooter className="mx-0 mb-0 items-center px-4 py-3">
          {progress ? (
            <span className="text-xs text-muted-foreground sm:mr-auto" aria-live="polite">
              {t("uploading", { done: progress.done, total: progress.total })}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => (created ? finish(created) : onOpenChange(false))}
            disabled={busy}
            className="h-11 w-full sm:w-auto md:h-8"
          >
            {created ? t("closeAndOpen") : t("cancel")}
          </Button>
          <Button
            type="submit"
            form="new-dev-task"
            disabled={busy || (!created && !title.trim()) || (Boolean(created) && picked.length === 0)}
            className="h-11 w-full sm:w-auto md:h-8"
          >
            {created ? t("retry") : create.isPending ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
