"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlusIcon, XIcon } from "lucide-react";

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

  return { picked, add, remove, clear };
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
  const { picked, add, remove, clear } = usePickedScreenshots(DEV_TASK_MAX_FILES_PER_DIALOG);
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
    clear();
  };

  const submit = async () => {
    if (busy || !title.trim()) return;
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
    if (picked.length > 0) {
      setProgress({ done: 0, total: picked.length });
      const result = await upload.mutateAsync({
        taskId: task.id,
        files: picked.map((p) => p.file),
        onProgress: (done) => setProgress({ done, total: picked.length }),
      });
      if (result.failed > 0) {
        toast.warning(t("partialUpload", { number, failed: result.failed }));
      } else {
        toast.success(t("created", { number }));
      }
    } else {
      toast.success(t("created", { number }));
    }
    reset();
    onOpenChange(false);
    onCreated?.(task);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Never drop the form half-sent: the upload loop is still running.
        if (!next && busy) return;
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

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium leading-none">{t("screenshotsLabel")}</span>
            {picked.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {picked.map((p) => (
                  <li
                    key={p.key}
                    className="relative aspect-square overflow-hidden rounded-lg border border-border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL preview */}
                    <img src={p.url} alt={p.file.name} className="size-full object-cover object-top" />
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
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="h-11 w-full sm:w-auto md:h-8"
          >
            {t("cancel")}
          </Button>
          <Button
            type="submit"
            form="new-dev-task"
            disabled={busy || !title.trim()}
            className="h-11 w-full sm:w-auto md:h-8"
          >
            {create.isPending ? t("submitting") : t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
