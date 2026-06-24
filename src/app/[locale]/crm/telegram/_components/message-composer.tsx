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
  SmileIcon,
  ZapIcon,
  CalendarPlusIcon,
  TagIcon,
  PhoneIcon,
  CheckIcon,
  MessageCircleIcon,
  MessageSquareTextIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { useCurrentRole } from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";

import { cn } from "@/lib/utils";
import {
  CHAT_ACCEPT_ATTR,
  CHAT_ALLOWED_MIME,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MAX_BYTES,
  chatAttachmentKind,
  formatBytes,
} from "@/lib/chat-attachments";
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
import {
  useComposerInsert,
  dispatchOpenAppointment,
} from "../_hooks/use-tg-events";
import {
  useCannedResponses,
  useCreateCanned,
  useUpdateCanned,
  useDeleteCanned,
  type CannedResponse,
  type CannedLang,
} from "../_hooks/use-canned";
import { useClinicInfo } from "../_hooks/use-conversation-meta";
import { fillPlaceholders, firstNameOf } from "../_lib/placeholders";
import { FileTypeIcon } from "./file-icon";

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

export function MessageComposer({ conversation }: MessageComposerProps) {
  const t = useTranslations("tgInbox.composer");
  const locale = useLocale();
  const [text, setText] = React.useState("");
  const [buttonRows, setButtonRows] = React.useState<InlineBtn[][]>([]);
  const [attachments, setAttachments] = React.useState<LocalAttachment[]>([]);
  const [isDragOver, setIsDragOver] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = React.useRef(0);

  // External insertions (AI rec / template chip / quick action) push text
  // into the composer via window event so callers don't need a callback prop.
  useComposerInsert(conversation.id, ({ text: incoming, mode }) => {
    setText((prev) => {
      if (mode === "replace" || !prev.trim()) return incoming;
      const sep = prev.endsWith("\n") || prev.endsWith(" ") ? "" : " ";
      return prev + sep + incoming;
    });
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
  });
  const send = useSendMessage();

  React.useEffect(() => {
    return () => {
      attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    };
    // intentionally only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-grow the textarea up to a cap; beyond that it scrolls internally.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

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
          kind?: "image" | "file";
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
                    kind: data.kind ?? chatAttachmentKind(data.mimeType),
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
        if (!CHAT_ALLOWED_MIME.has(file.type)) {
          rejected += 1;
          continue;
        }
        if (file.size > CHAT_MAX_BYTES) {
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
        const remaining = CHAT_MAX_ATTACHMENTS - prev.length;
        if (remaining <= 0) {
          toast.error(t("upload.tooMany", { max: CHAT_MAX_ATTACHMENTS }));
          return prev;
        }
        const slice = accepted.slice(0, remaining);
        if (accepted.length > remaining) {
          toast.error(t("upload.tooMany", { max: CHAT_MAX_ATTACHMENTS }));
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

  const appendText = React.useCallback((body: string) => {
    setText((prev) => (prev ? `${prev}\n${body}` : body));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const onPickTemplate = (tpl: Template) => {
    appendText(locale === "uz" ? tpl.bodyUz : tpl.bodyRu);
  };

  const insertEmoji = React.useCallback((emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    setText((prev) => prev.slice(0, start) + emoji + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
    });
  }, []);

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
            <PaperclipIcon className="size-4" />
            {t("upload.dropHere")}
          </div>
        </div>
      ) : null}

      <div className="p-2.5 sm:p-3">
        <div
          className={cn(
            "overflow-hidden rounded-[20px] border border-border/70 bg-card shadow-sm",
            "transition-[border-color,box-shadow] duration-[var(--motion-dur-base)] ease-out",
            "focus-within:border-primary/40 focus-within:shadow-md focus-within:shadow-primary/5",
          )}
        >
          {buttonRows.length > 0 ? (
            <InlineButtonsEditor rows={buttonRows} onChange={setButtonRows} />
          ) : null}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 border-b border-border/60 bg-muted/20 p-3">
              {attachments.map((a) => {
                const isImage = a.file.type.startsWith("image/");
                return (
                  <div
                    key={a.id}
                    className={cn(
                      "relative overflow-hidden rounded-xl border border-border/70 bg-background",
                      isImage
                        ? "size-20"
                        : "flex h-16 w-52 items-center gap-2 p-2",
                    )}
                  >
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.previewUrl}
                        alt={a.file.name}
                        className={cn(
                          "size-full object-cover",
                          a.status !== "ready" && "opacity-60",
                        )}
                      />
                    ) : (
                      <>
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <FileTypeIcon nameOrExt={a.file.name} className="size-5" />
                        </span>
                        <div className="min-w-0 flex-1 pr-4">
                          <div
                            className="truncate text-xs font-medium"
                            title={a.file.name}
                          >
                            {a.file.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatBytes(a.file.size)}
                          </div>
                        </div>
                      </>
                    )}
                    {a.status === "uploading" ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/50">
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
                );
              })}
            </div>
          ) : null}

          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={t("placeholder")}
            rows={1}
            className="min-h-[46px] max-h-[180px] resize-none overflow-y-auto border-0 bg-transparent px-3.5 py-3 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            aria-label={t("textareaAria")}
          />

          <div className="flex items-center gap-0.5 px-2 pb-2">
            <QuickActions conversation={conversation} onInsert={appendText} />
            <CannedPicker conversation={conversation} onInsert={appendText} />
            <TemplatePicker onPick={onPickTemplate} />
            <EmojiPicker onPick={insertEmoji} />
            <IconAction
              icon={<PaperclipIcon className="size-[18px]" />}
              iconClassName="motion-safe:group-hover:-rotate-12"
              label={t("upload.attach")}
              onClick={() => fileInputRef.current?.click()}
            />
            <IconAction
              icon={<PlusIcon className="size-[18px]" />}
              iconClassName="motion-safe:group-hover:rotate-90"
              label={t("inlineButtons.add")}
              active={buttonRows.length > 0}
              onClick={() =>
                setButtonRows((prev) =>
                  prev.length === 0 ? [[{ text: "", callback_data: "" }]] : prev,
                )
              }
            />

            <button
              type="button"
              onClick={onSend}
              disabled={!canSend}
              aria-label={t("sendAria")}
              className={cn(
                "ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm",
                "transition-[transform,background-color,box-shadow,opacity] duration-[var(--motion-dur-fast)] ease-out",
                "hover:bg-primary/90 hover:shadow-md hover:shadow-primary/20 motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                "disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none",
              )}
            >
              {send.isPending || uploadingCount > 0 ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SendIcon className="size-4 -translate-x-px" />
              )}
            </button>
          </div>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_ACCEPT_ATTR}
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

type IconActionProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "onClick"
> & {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  variant?: "default" | "primary";
  active?: boolean;
  iconClassName?: string;
};

/** Icon-only round affordance for the composer action bar (messenger style). */
const IconAction = React.forwardRef<HTMLButtonElement, IconActionProps>(
  function IconAction(
    { icon, label, onClick, disabled, variant = "default", active, iconClassName, className, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={cn(
          "group inline-flex size-9 items-center justify-center rounded-full text-muted-foreground",
          "transition-[transform,background-color,color,box-shadow] duration-[var(--motion-dur-fast)] ease-out",
          "hover:bg-muted hover:text-foreground motion-safe:hover:-translate-y-px active:translate-y-0 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 focus-visible:ring-offset-card",
          variant === "primary" && "text-primary hover:bg-primary/10 hover:text-primary",
          active && "bg-primary/10 text-primary",
          "disabled:pointer-events-none disabled:opacity-40",
          className,
        )}
        {...rest}
      >
        <span
          className={cn(
            "inline-flex items-center transition-transform duration-[var(--motion-dur-base)] ease-out motion-safe:group-hover:scale-110 motion-safe:group-active:scale-90",
            iconClassName,
          )}
        >
          {icon}
        </span>
      </button>
    );
  },
);

function QuickActions({
  conversation,
  onInsert,
}: {
  conversation: InboxConversation;
  onInsert: (text: string) => void;
}) {
  const t = useTranslations("tgInbox.composer.quick");
  const [open, setOpen] = React.useState(false);
  const callable = conversation.patient?.phone
    ? conversation.patient.phone.replace(/\s/g, "")
    : null;

  const close = () => setOpen(false);

  const onBook = () => {
    if (!conversation.patientId) {
      toast.error(t("needPatient"));
      close();
      return;
    }
    dispatchOpenAppointment({ conversationId: conversation.id });
    close();
  };

  const insert = (text: string) => {
    onInsert(text);
    close();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconAction
          variant="primary"
          icon={<ZapIcon className="size-[18px]" />}
          iconClassName={cn(
            "motion-safe:group-hover:rotate-[-8deg]",
            open && "motion-safe:scale-110",
          )}
          label={t("label")}
          active={open}
          aria-expanded={open}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("title")}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <QuickCard
            icon={<CalendarPlusIcon className="size-4" />}
            label={t("book")}
            onClick={onBook}
          />
          {callable ? (
            <QuickCard
              icon={<PhoneIcon className="size-4" />}
              label={t("call")}
              href={`tel:${callable}`}
              onNavigate={close}
            />
          ) : (
            <QuickCard
              icon={<PhoneIcon className="size-4" />}
              label={t("call")}
              disabled
            />
          )}
          <QuickCard
            icon={<TagIcon className="size-4" />}
            label={t("price")}
            onClick={() => insert(t("priceText"))}
          />
          <QuickCard
            icon={<CheckIcon className="size-4" />}
            label={t("confirm")}
            onClick={() => insert(t("confirmText"))}
          />
          <QuickCard
            icon={<MessageCircleIcon className="size-4" />}
            label={t("askPhone")}
            onClick={() => insert(t("askPhoneText"))}
            className="col-span-2"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QuickCard({
  icon,
  label,
  onClick,
  href,
  onNavigate,
  disabled,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  onNavigate?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const base =
    "motion-hover-lift motion-press group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-[12px] font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:pointer-events-none";
  const inner = (
    <>
      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-[transform,background-color] duration-[var(--motion-dur-base)] ease-out motion-safe:group-hover:scale-110 group-hover:bg-primary/15">
        {icon}
      </span>
      <span className="min-w-0 flex-1 leading-tight">{label}</span>
    </>
  );
  if (href) {
    return (
      <a href={href} onClick={onNavigate} className={cn(base, className)}>
        {inner}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        base,
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {inner}
    </button>
  );
}

const EMOJIS = [
  "👍", "🙏", "😊", "🤝", "✅", "❤️", "🎉", "👏",
  "💪", "🙌", "😉", "🤗", "👌", "🔥", "⭐", "💯",
  "✨", "🫶", "🙂", "😇", "🤔", "👋", "📋", "📅",
  "⏰", "📞", "📍", "💊", "🩺", "🏥", "💉", "🧪",
];

function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const t = useTranslations("tgInbox.composer");
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconAction
          icon={<SmileIcon className="size-[18px]" />}
          iconClassName="motion-safe:group-hover:rotate-12"
          label={t("emoji.label")}
          active={open}
          aria-expanded={open}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[280px] p-2">
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => onPick(emoji)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-lg leading-none transition-[transform,background-color] duration-[var(--motion-dur-fast)] ease-out hover:bg-muted motion-safe:hover:scale-125 active:scale-95"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
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
        <IconAction
          icon={<FileTextIcon className="size-[18px]" />}
          label={t("template.label")}
          active={open}
          aria-expanded={open}
        />
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

function CannedPicker({
  conversation,
  onInsert,
}: {
  conversation: InboxConversation;
  onInsert: (text: string) => void;
}) {
  const t = useTranslations("tgInbox.composer.canned");
  const locale = useLocale();
  const role = useCurrentRole();
  const isAdmin = role === "ADMIN" || role === "SUPER_ADMIN";
  const [open, setOpen] = React.useState(false);
  const [lang, setLang] = React.useState<CannedLang>(
    locale === "uz" ? "UZ" : "RU",
  );
  const [manage, setManage] = React.useState(false);

  const listQ = useCannedResponses(open);
  const clinicQ = useClinicInfo(open);

  const items = React.useMemo(
    () => (listQ.data?.rows ?? []).filter((c) => c.lang === lang),
    [listQ.data, lang],
  );

  const onPick = (c: CannedResponse) => {
    const name = conversation.patient?.fullName ?? "";
    const clinic = clinicQ.data;
    const filled = fillPlaceholders(c.body, {
      firstName: firstNameOf(name),
      name,
      clinic: clinic ? (c.lang === "UZ" ? clinic.nameUz : clinic.nameRu) : "",
      phone: clinic?.phone ?? "",
      address: clinic
        ? (c.lang === "UZ" ? clinic.addressUz : clinic.addressRu) ?? ""
        : "",
    });
    onInsert(filled);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setManage(false);
      }}
    >
      <PopoverTrigger asChild>
        <IconAction
          icon={<MessageSquareTextIcon className="size-[18px]" />}
          label={t("label")}
          active={open}
          aria-expanded={open}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">{t("title")}</span>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
              {(["RU", "UZ"] as CannedLang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] font-semibold transition-colors",
                    lang === l
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            {isAdmin ? (
              <Button
                variant={manage ? "secondary" : "ghost"}
                size="icon-xs"
                onClick={() => setManage((v) => !v)}
                aria-label={t("manage")}
                title={t("manage")}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        {manage ? (
          <CannedManager lang={lang} items={items} isLoading={listQ.isLoading} />
        ) : (
          <ScrollArea className="max-h-[320px]">
            {listQ.isLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                <Loader2Icon className="mx-auto size-4 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">
                {t("empty")}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => onPick(c)}
                      className="block w-full px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                    >
                      <div className="font-medium">{c.title}</div>
                      <div className="line-clamp-2 text-muted-foreground">
                        {c.body}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CannedManager({
  lang,
  items,
  isLoading,
}: {
  lang: CannedLang;
  items: CannedResponse[];
  isLoading: boolean;
}) {
  const t = useTranslations("tgInbox.composer.canned");
  const create = useCreateCanned();
  const update = useUpdateCanned();
  const del = useDeleteCanned();

  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");

  const reset = () => {
    setEditingId(null);
    setTitle("");
    setBody("");
  };

  const startEdit = (c: CannedResponse) => {
    setEditingId(c.id);
    setTitle(c.title);
    setBody(c.body);
  };

  const canSave = title.trim().length > 0 && body.trim().length > 0;
  const isSaving = create.isPending || update.isPending;

  const onSave = async () => {
    if (!canSave) return;
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, title: title.trim(), body: body.trim() });
        toast.success(t("saved"));
      } else {
        await create.mutateAsync({ title: title.trim(), body: body.trim(), lang });
        toast.success(t("created"));
      }
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveError"));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await del.mutateAsync(id);
      if (editingId === id) reset();
      toast.success(t("deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("saveError"));
    }
  };

  return (
    <div className="flex flex-col">
      <div className="space-y-1.5 border-b border-border bg-muted/20 p-2.5">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className="h-8 text-xs"
          aria-label={t("titlePlaceholder")}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("bodyPlaceholder")}
          rows={3}
          className="min-h-[60px] resize-none text-xs"
          aria-label={t("bodyPlaceholder")}
        />
        <div className="flex items-center justify-end gap-1.5">
          {editingId ? (
            <Button variant="ghost" size="xs" onClick={reset} disabled={isSaving}>
              {t("cancel")}
            </Button>
          ) : null}
          <Button size="xs" onClick={onSave} disabled={!canSave || isSaving}>
            {isSaving ? (
              <Loader2Icon className="size-3 animate-spin" />
            ) : editingId ? (
              <CheckIcon className="size-3" />
            ) : (
              <PlusIcon className="size-3" />
            )}
            {editingId ? t("save") : t("add")}
          </Button>
        </div>
      </div>
      <ScrollArea className="max-h-[220px]">
        {isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            <Loader2Icon className="mx-auto size-4 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {t("empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex items-start gap-1.5 px-2.5 py-2",
                  editingId === c.id && "bg-primary/5",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{c.title}</div>
                  <div className="line-clamp-1 text-[11px] text-muted-foreground">
                    {c.body}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={t("edit")}
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(c.id)}
                  disabled={del.isPending}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  aria-label={t("delete")}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
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
