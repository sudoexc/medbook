"use client";

/**
 * Phase 15 Wave 4 — AI marketing-copy suggest popover.
 *
 * Mounts inside `template-editor.tsx` next to each body field. Hits
 * `POST /api/crm/ai/marketing-copy`, renders the variants, and lets the
 * admin paste a chosen one into the matching `bodyRu` / `bodyUz` field.
 *
 * Wave 4 is generation-only: clicking "Использовать" calls `onUse(text)`
 * which the editor wires to its form state. The admin still presses the
 * existing Save button to persist. No autosave.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { CopyIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import { AI_ENABLED } from "@/lib/ai-enabled";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";

import type { TemplateChannel } from "../_hooks/types";

// ─────────────────────────────────────────────────────────────────────────────
// Types — kept in sync with src/server/ai/marketing-copy.ts
// ─────────────────────────────────────────────────────────────────────────────

type Channel = "TG" | "EMAIL" | "PUSH" | "INAPP";
type Audience =
  | "reactivation"
  | "birthday"
  | "reminder"
  | "no-show"
  | "general";
type Tone = "friendly" | "professional" | "urgent";
type Locale = "ru" | "uz";

type Variant = {
  text: string;
  charCount: number;
  withinLimit: boolean;
};

type ApiResult = {
  variants: Variant[];
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** Current template channel from the editor — prefilled into the form. */
  channel: TemplateChannel;
  /** Locale of the body field this popover sits next to. */
  locale: Locale;
  /** Trigger key from the form, used to guess audience (e.g. `birthday`). */
  triggerKey: string | null;
  /** Called with the chosen variant text — editor pastes into bodyRu/bodyUz. */
  onUse: (text: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Defaults
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_BY_CHANNEL: Record<Channel, number> = {
  TG: 500,
  EMAIL: 2000,
  PUSH: 200,
  INAPP: 300,
};

const AUDIENCE_VALUES: Audience[] = [
  "reactivation",
  "birthday",
  "reminder",
  "no-show",
  "general",
];

/**
 * Heuristic: map a template trigger key to the closest audience tag. Falls
 * through to "general" so nothing crashes on a custom key.
 */
function guessAudienceFromTrigger(key: string | null): Audience {
  if (!key) return "general";
  const k = key.toLowerCase();
  if (k.includes("reactivation") || k.includes("dormant")) return "reactivation";
  if (k.includes("birthday")) return "birthday";
  if (k.includes("reminder")) return "reminder";
  if (k.includes("no-show") || k.includes("noshow")) return "no-show";
  return "general";
}

/** Editor uses TG/EMAIL/CALL/VISIT/INAPP; the LLM only knows the message ones. */
function templateChannelToCopyChannel(c: TemplateChannel): Channel {
  if (c === "TG") return "TG";
  if (c === "EMAIL") return "EMAIL";
  if (c === "INAPP") return "INAPP";
  // CALL / VISIT aren't really "copy" channels; default to TG sizing.
  return "TG";
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AiCopySuggest({
  channel,
  locale,
  triggerKey,
  onUse,
}: Props) {
  const t = useTranslations("notifications.marketingCopy");

  const initialChannel = templateChannelToCopyChannel(channel);
  const [open, setOpen] = React.useState(false);
  const [formChannel, setFormChannel] = React.useState<Channel>(initialChannel);
  const [audience, setAudience] = React.useState<Audience>(() =>
    guessAudienceFromTrigger(triggerKey),
  );
  const [tone, setTone] = React.useState<Tone>("friendly");
  const [maxChars, setMaxChars] = React.useState<number>(
    DEFAULT_MAX_BY_CHANNEL[initialChannel],
  );
  const [promo, setPromo] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [variants, setVariants] = React.useState<Variant[]>([]);

  // Re-prefill when the editor's channel / trigger changes while popover is closed.
  React.useEffect(() => {
    if (open) return;
    const c = templateChannelToCopyChannel(channel);
    setFormChannel(c);
    setMaxChars(DEFAULT_MAX_BY_CHANNEL[c]);
    setAudience(guessAudienceFromTrigger(triggerKey));
  }, [channel, triggerKey, open]);

  // When the user changes the channel inside the form, follow the maxChars
  // default unless they've already typed a custom value (kept simple — we
  // always overwrite; the input is small enough for them to retype).
  const onChannelChange = (c: Channel) => {
    setFormChannel(c);
    setMaxChars(DEFAULT_MAX_BY_CHANNEL[c]);
  };

  const onGenerate = async () => {
    setLoading(true);
    setError(null);
    setVariants([]);
    try {
      const res = await fetch("/api/crm/ai/marketing-copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channel: formChannel,
          audience,
          locale,
          tone,
          maxChars,
          promo: promo.trim() || undefined,
          customNotes: notes.trim() || undefined,
          variants: 3,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as ApiResult;
      setVariants(data.variants ?? []);
    } catch (e) {
      setError((e as Error).message || t("error"));
    } finally {
      setLoading(false);
    }
  };

  const onCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("error"));
    }
  };

  const onPick = (text: string) => {
    onUse(text);
    setOpen(false);
  };

  // AI surface paused — hide the generate-copy trigger entirely.
  if (!AI_ENABLED) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
        >
          <SparklesIcon className="size-3.5" />
          {t("button")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[380px] max-h-[80vh] overflow-y-auto p-3"
      >
        <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <SparklesIcon className="size-4" />
          {t("title")}
        </div>

        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t("channelLabel")}
              </Label>
              <Select
                value={formChannel}
                onValueChange={(v) => onChannelChange(v as Channel)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TG">Telegram</SelectItem>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="PUSH">Push</SelectItem>
                  <SelectItem value="INAPP">In-app</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {t("audienceLabel")}
              </Label>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as Audience)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIENCE_VALUES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audience.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {t("toneLabel")}
            </Label>
            <RadioGroup
              value={tone}
              onValueChange={(v) => setTone(v as Tone)}
              className="grid grid-cols-3 gap-1"
            >
              {(["friendly", "professional", "urgent"] as Tone[]).map((tn) => (
                <label
                  key={tn}
                  className="flex cursor-pointer items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted"
                >
                  <RadioGroupItem value={tn} className="size-3" />
                  <span>{t(`tone.${tn}`)}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="space-y-1">
            <Label
              htmlFor="ai-max-chars"
              className="text-[11px] text-muted-foreground"
            >
              {t("maxCharsLabel")}
            </Label>
            <Input
              id="ai-max-chars"
              type="number"
              min={20}
              max={5000}
              value={maxChars}
              onChange={(e) => {
                const n = Number.parseInt(e.currentTarget.value, 10);
                if (Number.isFinite(n) && n > 0) setMaxChars(n);
              }}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label
              htmlFor="ai-promo"
              className="text-[11px] text-muted-foreground"
            >
              {t("promoLabel")}
            </Label>
            <Input
              id="ai-promo"
              value={promo}
              onChange={(e) => setPromo(e.currentTarget.value)}
              maxLength={200}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label
              htmlFor="ai-notes"
              className="text-[11px] text-muted-foreground"
            >
              {t("notesLabel")}
            </Label>
            <Textarea
              id="ai-notes"
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              maxLength={200}
              rows={2}
              className="text-xs"
            />
          </div>

          <Button
            type="button"
            onClick={onGenerate}
            disabled={loading}
            className="w-full"
            size="sm"
          >
            {loading ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <SparklesIcon className="size-3.5" />
            )}
            {loading ? t("loading") : t("generate")}
          </Button>
        </div>

        {error ? (
          <div className="mt-3 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            <div className="font-medium">{t("error")}</div>
            <div className="mt-1 opacity-80">{error}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={onGenerate}
              disabled={loading}
            >
              {t("retry")}
            </Button>
          </div>
        ) : null}

        {variants.length > 0 ? (
          <div className="mt-3 space-y-2">
            {variants.map((v, idx) => (
              <div
                key={idx}
                className="rounded border border-border bg-muted/30 p-2"
              >
                <pre className="whitespace-pre-wrap font-sans text-xs leading-snug text-foreground">
                  {v.text}
                </pre>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <span
                    className={
                      "rounded px-1.5 py-0.5 text-[10px] " +
                      (v.withinLimit
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive")
                    }
                  >
                    {t("charCount", { n: v.charCount })}
                    {!v.withinLimit ? ` · ${t("overLimit")}` : null}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onCopy(v.text)}
                    >
                      <CopyIcon className="size-3" />
                      {t("copy")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onPick(v.text)}
                    >
                      {t("use")}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
