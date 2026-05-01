"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import {
  SendIcon,
  PlusIcon,
  MinusIcon,
  Loader2Icon,
  FileTextIcon,
  PaperclipIcon,
  XIcon,
  ImageIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

import type { InboxConversation } from "../_hooks/types";
import {
  useSendMessage,
  type ChatAttachment,
} from "../_hooks/use-send-message";

export interface MessageComposerProps {
  conversation: InboxConversation;
}

type Template = {
  id: string;
  key: string;
  nameRu: string;
  nameUz: string;
  channel: string;
  bodyRu: string;
  bodyUz: string;
};

type InlineBtn = { text: string; callback_data?: string; url?: string };

type LocalAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  remote?: ChatAttachment;
  errorMessage?: string;
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;

export function MessageComposer({ conversation }: MessageComposerProps) {
  const t = useTranslations("tgInbox.composer");
  const locale = useLocale();
  const [text, setText] = React.useState("");
  const [buttonRows, setButtonRows] = React.useState<InlineBtn[][]>([]);
  const [attachments, setAttachments] = React.useState<LocalAttachment[]>([]);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragCounterRef = React.useRef(0);
  const send = useSendMessage();

  React.useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadingCount = attachments.filter(
    (a) => a.status === "uploading",
  ).length;
  const readyAttachments = attachments
    .filter((a) => a.status === "ready" && a.remote)
    .map((a) => a.remote!) as ChatAttachment[];

  const canSend =
    !send.isPending &&
    uploadingCount === 0 &&
    (text.trim().length > 0 || readyAttachments.length > 0);

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const removed = prev.find((a) => a.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  };

  const uploadOne = React.useCallback(
    async (id: string, file: File) => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(
          `/api/crm/conversations/${conversation.id}/attachments`,
          {
            method: "POST",
            credentials: "include",
            body: form,
          },
        );
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `Upload failed: ${res.status}`);
        }
        const data = (await res.json()) as {
          url: string;
          mimeType: string;
          sizeBytes: number;
          name: string;
        };
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "ready",
                  remote: {
                    kind: "image",
                    url: data.url,
                    mimeType: data.mimeType,
                    sizeBytes: data.sizeBytes,
                    name: data.name,
                  },
                }
              : a,
          ),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, status: "error", errorMessage: msg } : a,
          ),
        );
        toast.error(msg);
      }
    },
    [conversation.id],
  );

  const addFiles = React.useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;
      const accepted: { id: string; file: File; previewUrl: string }[] = [];
      let rejected = 0;
      for (const file of list) {
        if (!ALLOWED_MIME.has(file.type)) {
          rejected += 1;
          continue;
        }
        if (file.size > MAX_BYTES) {
          rejected += 1;
          continue;
        }
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        accepted.push({ id, file, previewUrl: URL.createObjectURL(file) });
      }
      if (rejected > 0) {
        toast.error(t("upload.rejectedSome", { count: rejected }));
      }
      if (accepted.length === 0) return;
      setAttachments((prev) => {
        const remaining = MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) {
          toast.error(t("upload.tooMany", { max: MAX_ATTACHMENTS }));
          return prev;
        }
        const slice = accepted.slice(0, remaining);
        if (accepted.length > remaining) {
          toast.error(t("upload.tooMany", { max: MAX_ATTACHMENTS }));
        }
        const next: LocalAttachment[] = [
          ...prev,
          ...slice.map((s) => ({
            id: s.id,
            file: s.file,
            previewUrl: s.previewUrl,
            status: "uploading" as const,
          })),
        ];
        slice.forEach((s) => void uploadOne(s.id, s.file));
        return next;
      });
    },
    [t, uploadOne],
  );

  const onSend = async () => {
    if (!canSend) return;
    const body = text.trim();
    const payload = {
      conversationId: conversation.id,
      body,
      buttons: buttonRows.length > 0 ? buttonRows : undefined,
      attachments:
        readyAttachments.length > 0 ? readyAttachments : undefined,
    };
    try {
      await send.mutateAsync(payload);
      setText("");
      setButtonRows([]);
      setAttachments((prev) => {
        prev.forEach((a) => URL.revokeObjectURL(a.previewUrl));
        return [];
      });
    } catch {
      // toast handled in hook
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void onSend();
    }
  };

  const onPickTemplate = (tpl: Template) => {
    const body = locale === "uz" ? tpl.bodyUz : tpl.bodyRu;
    setText((prev) => (prev ? `${prev}\n${body}` : body));
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    dragCounterRef.current += 1;
    setIsDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
  };
  const onDragLeave = () => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      className={cn(
        "relative border-t border-border bg-card",
        isDragOver && "outline outline-2 outline-offset-[-2px] outline-primary/60",
      )}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10 backdrop-blur-[1px]">
          <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-card px-3 py-2 text-sm font-medium text-primary shadow-sm">
            <ImageIcon className="size-4" />
            {t("upload.dropHere")}
          </div>
        </div>
      ) : null}

      {buttonRows.length > 0 ? (
        <InlineButtonsEditor rows={buttonRows} onChange={setButtonRows} />
      ) : null}

      {attachments.length > 0 ? (
        <div className="flex flex-wrap gap-2 border-b border-border bg-muted/20 p-3">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="relative size-20 overflow-hidden rounded-md border border-border bg-background"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.previewUrl}
                alt={a.file.name}
                className={cn(
                  "size-full object-cover",
                  a.status !== "ready" && "opacity-60",
                )}
              />
              {a.status === "uploading" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                  <Loader2Icon className="size-5 animate-spin text-foreground" />
                </div>
              ) : null}
              {a.status === "error" ? (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-destructive/30 text-[10px] font-semibold text-destructive-foreground"
                  title={a.errorMessage}
                >
                  !
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                className="absolute right-0.5 top-0.5 inline-flex size-5 items-center justify-center rounded-full bg-foreground/70 text-background transition-colors hover:bg-foreground"
                aria-label={t("upload.remove")}
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2 p-3">
        <div className="flex shrink-0 flex-col gap-1">
          <TemplatePicker onPick={onPickTemplate} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            aria-label={t("upload.attach")}
            title={t("upload.attach")}
          >
            <PaperclipIcon className="size-3" /> {t("upload.label")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setButtonRows((prev) =>
                prev.length === 0 ? [[{ text: "", callback_data: "" }]] : prev,
              )
            }
            aria-label={t("inlineButtons.add")}
            title={t("inlineButtons.add")}
          >
            <PlusIcon className="size-3" /> {t("inlineButtons.label")}
          </Button>
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={t("placeholder")}
          className="min-h-[52px] max-h-[220px] flex-1 resize-y"
          aria-label={t("textareaAria")}
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={t("sendAria")}
        >
          {send.isPending || uploadingCount > 0 ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <SendIcon className="size-3" />
          )}
          {t("send")}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (tpl: Template) => void }) {
  const t = useTranslations("tgInbox.composer");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const q = useQuery<{ rows: Template[] }>({
    queryKey: ["tg-templates-picker"],
    queryFn: async ({ signal }) => {
      const res = await fetch(
        "/api/crm/notifications/templates?channel=TG&limit=50",
        {  credentials: "include", signal },
      );
      if (!res.ok) throw new Error("Load failed");
      return res.json();
    },
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={t("template.label")}>
          <FileTextIcon className="size-3" /> {t("template.label")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold">
          {t("template.title")}
        </div>
        <ScrollArea className="max-h-[320px]">
          {q.isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <Loader2Icon className="mx-auto size-4 animate-spin" />
            </div>
          ) : (q.data?.rows?.length ?? 0) === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              {t("template.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {q.data!.rows.map((tpl) => {
                const name = locale === "uz" ? tpl.nameUz : tpl.nameRu;
                const body = locale === "uz" ? tpl.bodyUz : tpl.bodyRu;
                return (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(tpl);
                      }}
                      className="block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                    >
                      <div className="font-medium">{name}</div>
                      <div className="line-clamp-2 text-muted-foreground">
                        {body}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function InlineButtonsEditor({
  rows,
  onChange,
}: {
  rows: InlineBtn[][];
  onChange: (next: InlineBtn[][]) => void;
}) {
  const t = useTranslations("tgInbox.composer.inlineButtons");

  const updateBtn = (ri: number, bi: number, patch: Partial<InlineBtn>) => {
    const next = rows.map((row, rIdx) =>
      rIdx === ri
        ? row.map((b, bIdx) => (bIdx === bi ? { ...b, ...patch } : b))
        : row,
    );
    onChange(next);
  };
  const addBtn = (ri: number) => {
    const next = rows.map((row, rIdx) =>
      rIdx === ri ? [...row, { text: "", callback_data: "" }] : row,
    );
    onChange(next);
  };
  const removeBtn = (ri: number, bi: number) => {
    const next = rows
      .map((row, rIdx) =>
        rIdx === ri ? row.filter((_, bIdx) => bIdx !== bi) : row,
      )
      .filter((row) => row.length > 0);
    onChange(next);
  };
  const addRow = () => {
    onChange([...rows, [{ text: "", callback_data: "" }]]);
  };
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-2 border-b border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">{t("header")}</div>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={addRow}>
            <PlusIcon className="size-3" /> {t("addRow")}
          </Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>
            {t("clear")}
          </Button>
        </div>
      </div>
      {rows.map((row, ri) => (
        <div key={ri} className="flex flex-wrap items-start gap-1">
          {row.map((b, bi) => (
            <div
              key={bi}
              className="flex items-center gap-1 rounded-md border border-border bg-background p-1"
            >
              <Input
                value={b.text}
                onChange={(e) => updateBtn(ri, bi, { text: e.target.value })}
                placeholder={t("textPlaceholder")}
                className="h-7 w-[140px] text-xs"
                aria-label={t("textPlaceholder")}
              />
              <Input
                value={b.callback_data ?? ""}
                onChange={(e) =>
                  updateBtn(ri, bi, { callback_data: e.target.value })
                }
                placeholder={t("dataPlaceholder")}
                className="h-7 w-[120px] text-xs"
                aria-label={t("dataPlaceholder")}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeBtn(ri, bi)}
                aria-label={t("remove")}
              >
                <MinusIcon className="size-3" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => addBtn(ri)}>
            <PlusIcon className="size-3" /> {t("addButton")}
          </Button>
        </div>
      ))}
    </div>
  );
}
