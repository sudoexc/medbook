"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { SendIcon, PlusIcon, MinusIcon, Loader2Icon, FileTextIcon } from "lucide-react";

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
import { useSendMessage } from "../_hooks/use-send-message";

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

/**
 * Bottom composer for the active chat.
 *
 * Features:
 *  - Text input with Enter=send, Shift+Enter=newline.
 *  - Template picker — loads `/api/crm/notifications/templates?channel=TG`.
 *  - Inline-buttons builder — JSON rows of `[{ text, callback_data|url }]`.
 *    Sent as `buttons` in the POST body; backend persists as Message.buttons
 *    (Telegram's `inline_keyboard` shape).
 *
 * Sending is always through our CRM POST — the bot webhook flushes to
 * Telegram via `send.ts`. Operators never talk to the Telegram API directly.
 */
export function MessageComposer({ conversation }: MessageComposerProps) {
  const t = useTranslations("tgInbox.composer");
  const locale = useLocale();
  const [text, setText] = React.useState("");
  const [buttonRows, setButtonRows] = React.useState<InlineBtn[][]>([]);
  const send = useSendMessage();

  const onSend = async () => {
    const body = text.trim();
    if (!body) return;
    const payload = {
      conversationId: conversation.id,
      body,
      buttons: buttonRows.length > 0 ? buttonRows : undefined,
    };
    try {
      await send.mutateAsync(payload);
      setText("");
      setButtonRows([]);
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

  return (
    <div className="border-t border-border bg-card">
      {buttonRows.length > 0 ? (
        <InlineButtonsEditor rows={buttonRows} onChange={setButtonRows} />
      ) : null}
      <div className="flex items-end gap-2 p-3">
        <div className="flex shrink-0 flex-col gap-1">
          <TemplatePicker onPick={onPickTemplate} />
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
          placeholder={t("placeholder")}
          className="min-h-[52px] max-h-[220px] flex-1 resize-y"
          aria-label={t("textareaAria")}
        />
        <Button
          type="button"
          onClick={onSend}
          disabled={send.isPending || text.trim().length === 0}
          aria-label={t("sendAria")}
        >
          {send.isPending ? (
            <Loader2Icon className="size-3 animate-spin" />
          ) : (
            <SendIcon className="size-3" />
          )}
          {t("send")}
        </Button>
      </div>
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (tpl: Template) => void }) {
  const t = useTranslations("tgInbox.composer");
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);

  const q = useQuery<{ rows: Template[] }>({
    queryKey: ["tg-templates-picker"],
    queryFn: async () => {
      const res = await fetch(
        "/api/crm/notifications/templates?channel=TG&limit=50",
        { credentials: "include" },
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
