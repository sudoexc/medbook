"use client";

/**
 * Phase 15 Wave 3 — NL "Ask AI" panel rendered inside the Cmd+K dialog.
 *
 * The user types a free-form question (Russian or Uzbek), submits with the
 * "Спросить" button or Cmd+Enter, and the panel renders the assistant's
 * answer plus deeplink chips returned by `/api/crm/ai/ask`.
 *
 * Conversation history is in-memory only — when the dialog closes the chat
 * clears (per the Wave 3 brief).
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  ArrowRightIcon,
  CalendarIcon,
  SendIcon,
  SparklesIcon,
  UserIcon,
  ZapIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Chip = {
  label: string;
  deeplink: string;
  kind: "action" | "patient" | "slot" | "appointment";
};

type AskResponse = {
  answer: string;
  chips: Chip[];
  toolTrace: Array<{ name: string; ok: boolean }>;
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

type ChatMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      chips: Chip[];
      tools: string[];
      error?: boolean;
    };

const MODEL_LABEL = "Claude Sonnet";

function chipIcon(kind: Chip["kind"]) {
  switch (kind) {
    case "patient":
      return UserIcon;
    case "slot":
      return CalendarIcon;
    case "appointment":
      return CalendarIcon;
    case "action":
    default:
      return ZapIcon;
  }
}

export interface AiAskPanelProps {
  /** Optional close-on-navigate callback so chip clicks can dismiss the dialog. */
  onNavigate?: () => void;
}

export function AiAskPanel({ onNavigate }: AiAskPanelProps) {
  const t = useTranslations("ai.ask");
  const tChips = useTranslations("ai.chip");
  const params = useParams();
  const locale = (typeof params?.locale === "string" ? params.locale : "ru") as
    | "ru"
    | "uz";
  const router = useRouter();

  const [input, setInput] = React.useState("");
  const [history, setHistory] = React.useState<ChatMessage[]>([]);
  const [loading, setLoading] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Scroll the conversation to the bottom whenever it grows.
  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [history, loading]);

  const submit = React.useCallback(async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setHistory((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);
    try {
      const res = await fetch("/api/crm/ai/ask", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, locale }),
      });
      if (!res.ok) {
        setHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            text: t("error"),
            chips: [],
            tools: [],
            error: true,
          },
        ]);
        return;
      }
      const data = (await res.json()) as AskResponse;
      setHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          chips: data.chips ?? [],
          tools: (data.toolTrace ?? []).map((entry) => entry.name),
        },
      ]);
    } catch {
      setHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          text: t("error"),
          chips: [],
          tools: [],
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, locale, t]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const goChip = (deeplink: string) => {
    onNavigate?.();
    router.push(`/${locale}${deeplink}`);
  };

  const chipLabel = (kind: Chip["kind"]) => {
    switch (kind) {
      case "slot":
        return tChips("openSlot");
      case "patient":
        return tChips("openPatient");
      case "action":
        return tChips("openAction");
      case "appointment":
        return tChips("openAppointment");
    }
  };

  return (
    <div className="flex h-[420px] flex-col">
      <div
        ref={listRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm"
      >
        {history.length === 0 && !loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <SparklesIcon className="size-6 opacity-60" />
            <div className="text-sm">{t("empty")}</div>
            <div className="max-w-xs text-[11px] leading-snug">
              {t("disclaimer")}
            </div>
          </div>
        ) : null}

        {history.map((m, idx) =>
          m.role === "user" ? (
            <div
              key={`u-${idx}`}
              className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground"
            >
              {m.text}
            </div>
          ) : (
            <div key={`a-${idx}`} className="max-w-[90%] space-y-2">
              <div
                className={cn(
                  "rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-foreground",
                  m.error && "bg-destructive/10 text-destructive",
                )}
              >
                {m.text}
              </div>
              {m.chips.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {m.chips.map((c, ci) => {
                    const Icon = chipIcon(c.kind);
                    return (
                      <button
                        type="button"
                        key={`${idx}-${ci}`}
                        onClick={() => goChip(c.deeplink)}
                        title={chipLabel(c.kind)}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-primary/5"
                      >
                        <Icon className="size-3.5 text-muted-foreground" />
                        <span className="truncate">{c.label}</span>
                        <ArrowRightIcon className="size-3 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="text-[10px] text-muted-foreground">
                {t("attribution", { model: MODEL_LABEL })}
                {m.tools.length > 0 ? ` · ${m.tools.join(", ")}` : ""}
              </div>
            </div>
          ),
        )}

        {loading ? (
          <div className="max-w-[60%]">
            <div className="rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:120ms]" />
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:240ms]" />
                <span className="ml-1 text-xs">{t("loading")}</span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="border-t bg-card p-3">
        <div className="flex items-end gap-2">
          <Textarea
            placeholder={t("placeholder")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            className="min-h-[60px] resize-none"
            aria-label={t("placeholder")}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void submit()}
            disabled={loading || input.trim().length === 0}
            className="h-9 shrink-0 gap-1"
          >
            <SendIcon className="size-3.5" />
            {t("send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
