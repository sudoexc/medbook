"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Send } from "lucide-react";

import { MCard, MEmpty, MSpinner } from "./mini-ui";
import { useT, useLang } from "./mini-i18n";
import { useMiniAppAuth } from "./miniapp-auth-provider";
import { useOpenConversation } from "../_hooks/use-conversations";
import {
  useConversationMessages,
  useSendMessage,
  type MiniAppMessage,
} from "../_hooks/use-conversation-messages";
import { useTelegramWebApp } from "@/hooks/use-telegram-webapp";

/**
 * Mini-App "Чат с клиникой" screen (Phase 2.1).
 *
 * Lifecycle:
 *   1. Mount → `useOpenConversation()` resolves (or creates) the patient's
 *      thread with this clinic and pins the channel to TG.
 *   2. Render history via `useConversationMessages(conversationId)`.
 *      Realtime: `tg.message.new` invalidates the cache via the SSE hook.
 *   3. Send → `useSendMessage()` writes an `IN` message + publishes the same
 *      `tg.message.new` event so the CRM inbox lights up.
 *
 * Layout notes:
 *   • IN = patient-sent → right bubble, accent background.
 *   • OUT = staff-sent → left bubble, section background.
 *   • Auto-scroll to bottom on new messages and on mount; input row pinned
 *     to the bottom via a sticky wrapper.
 */
export function MessagesScreen() {
  const t = useT();
  const lang = useLang();
  const router = useRouter();
  const { clinicSlug } = useMiniAppAuth();
  const tg = useTelegramWebApp();
  const open = useOpenConversation();

  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [openError, setOpenError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);

  const messages = useConversationMessages(conversationId);
  const send = useSendMessage(conversationId);

  // 1) Resolve conversation once on mount. The find-or-create endpoint is
  // idempotent, so a flicker on remount is harmless.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await open.mutateAsync();
        if (!cancelled) setConversationId(res.conversationId);
      } catch (e) {
        if (!cancelled) {
          const err = e as Error;
          setOpenError(err.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // mutateAsync is stable; we deliberately fire once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back button → home; main button stays hidden (we use an in-page send btn).
  React.useEffect(() => {
    const off = tg.setBackButton(() => router.push(`/c/${clinicSlug}/my`));
    return off;
  }, [tg, router, clinicSlug]);
  React.useEffect(() => {
    const off = tg.setMainButton({ visible: false });
    return off;
  }, [tg]);

  // Auto-scroll to newest message.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.data?.length]);

  const handleSend = React.useCallback(async () => {
    const body = draft.trim();
    if (!body || !conversationId || send.isPending) return;
    setDraft("");
    try {
      await send.mutateAsync({ body });
      tg.haptic.impact("light");
    } catch {
      tg.haptic.notification("error");
      tg.showAlert(t.chat.sendError);
      setDraft(body);
    }
  }, [draft, conversationId, send, tg, t.chat.sendError]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const grouped = React.useMemo(
    () => groupByDay(messages.data ?? [], lang, t.chat.today, t.chat.yesterday),
    [messages.data, lang, t.chat.today, t.chat.yesterday],
  );

  return (
    <div
      className="flex flex-col"
      style={{
        height: "calc(100dvh - var(--ma-tabbar-offset, 0px) - 2rem)",
      }}
    >
      <div className="mb-3">
        <h1 className="text-xl font-bold leading-tight">{t.chat.title}</h1>
        <p className="mt-1 text-xs" style={{ color: "var(--tg-hint)" }}>
          {t.chat.subtitle}
        </p>
      </div>

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto pb-3"
        style={{ scrollBehavior: "smooth" }}
      >
        {openError ? (
          <MCard>
            <p className="text-sm font-medium">{t.chat.openError}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--tg-hint)" }}>
              {openError}
            </p>
          </MCard>
        ) : !conversationId || messages.isLoading ? (
          <MSpinner label={t.chat.opening} />
        ) : grouped.length === 0 ? (
          <MEmpty icon={MessageSquare}>{t.chat.empty}</MEmpty>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.label}>
                <div
                  className="mb-2 flex justify-center text-[11px] font-medium"
                  style={{ color: "var(--tg-hint)" }}
                >
                  <span
                    className="rounded-full px-3 py-0.5"
                    style={{
                      backgroundColor:
                        "color-mix(in oklch, var(--tg-hint) 14%, transparent)",
                    }}
                  >
                    {group.label}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map((m) => (
                    <Bubble key={m.id} message={m} dict={t.chat} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div
        className="sticky -mx-4 border-t px-4 py-3"
        style={{
          // Sits flush on top of the tab bar; falls back to the viewport
          // bottom on screens where the bar is hidden.
          bottom: "var(--ma-tabbar-offset, 0px)",
          backgroundColor: "var(--tg-bg)",
          borderColor: "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.chat.inputPlaceholder}
            rows={1}
            disabled={!conversationId || send.isPending}
            className="min-h-[44px] max-h-32 flex-1 resize-none rounded-2xl border px-3 py-2.5 text-sm outline-none disabled:opacity-60"
            style={{
              backgroundColor: "var(--tg-section-bg)",
              color: "var(--tg-text)",
              borderColor: "color-mix(in oklch, var(--tg-hint) 25%, transparent)",
            }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!conversationId || send.isPending || draft.trim() === ""}
            aria-label={t.chat.send}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full ma-press active:scale-[0.95] disabled:opacity-50"
            style={{ backgroundColor: "var(--tg-accent)", color: "#fff" }}
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  message,
  dict,
}: {
  message: MiniAppMessage;
  dict: {
    statusFailed: string;
    statusSent: string;
    statusDelivered: string;
    statusRead: string;
  };
}) {
  // IN = patient-sent → align right.
  const isOwn = message.direction === "IN";
  const time = formatTime(message.createdAt);
  const status = message.status;

  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm"
        style={
          isOwn
            ? {
                backgroundColor: "var(--tg-accent)",
                color: "#fff",
                borderBottomRightRadius: 6,
              }
            : {
                backgroundColor: "var(--tg-section-bg)",
                color: "var(--tg-text)",
                borderBottomLeftRadius: 6,
              }
        }
      >
        {message.body ? (
          <div className="whitespace-pre-wrap break-words leading-snug">
            {message.body}
          </div>
        ) : null}
        <div
          className="mt-1 flex items-center justify-end gap-1 text-[10px]"
          style={{
            color: isOwn
              ? "color-mix(in oklch, #fff 75%, transparent)"
              : "var(--tg-hint)",
          }}
        >
          <span>{time}</span>
          {isOwn ? <span>{statusGlyph(status, dict)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function statusGlyph(
  status: string,
  dict: {
    statusFailed: string;
    statusSent: string;
    statusDelivered: string;
    statusRead: string;
  },
): string {
  switch (status) {
    case "FAILED":
      return dict.statusFailed;
    case "READ":
      return dict.statusRead;
    case "DELIVERED":
      return dict.statusDelivered;
    case "QUEUED":
    case "SENT":
    default:
      return dict.statusSent;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

type DayGroup = { label: string; items: MiniAppMessage[] };

function groupByDay(
  items: MiniAppMessage[],
  lang: "RU" | "UZ",
  todayLabel: string,
  yesterdayLabel: string,
): DayGroup[] {
  if (items.length === 0) return [];
  const now = new Date();
  const today = startOfDay(now).getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  const groups: DayGroup[] = [];
  const locale = lang === "UZ" ? "uz-Latn-UZ" : "ru-RU";

  for (const m of items) {
    const d = new Date(m.createdAt);
    const dayStart = startOfDay(d).getTime();
    let label: string;
    if (dayStart === today) label = todayLabel;
    else if (dayStart === yesterday) label = yesterdayLabel;
    else
      label = d.toLocaleDateString(locale, {
        day: "2-digit",
        month: "long",
        year: dayStart < startOfYear(now).getTime() ? "numeric" : undefined,
      });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(m);
    else groups.push({ label, items: [m] });
  }
  return groups;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfYear(d: Date): Date {
  const x = new Date(d);
  x.setMonth(0, 1);
  x.setHours(0, 0, 0, 0);
  return x;
}
