"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { UsersIcon, LayersIcon, TagIcon, PlusIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { TagChip } from "@/components/atoms/tag-chip";
import type { TagChipColor } from "@/components/atoms/tag-chip";

import {
  usePatientTags,
  type BroadcastSegment,
  type PatientSegmentKind,
} from "../_hooks/use-broadcast";

const SEGMENT_OPTIONS: Array<{ kind: PatientSegmentKind; color: TagChipColor }> = [
  { kind: "NEW", color: "primary" },
  { kind: "ACTIVE", color: "success" },
  { kind: "DORMANT", color: "warning" },
  { kind: "VIP", color: "violet" },
  { kind: "CHURN", color: "pink" },
];

type AudienceKind = BroadcastSegment["kind"];

const KIND_TABS: Array<{ kind: AudienceKind; icon: typeof UsersIcon }> = [
  { kind: "all", icon: UsersIcon },
  { kind: "segment", icon: LayersIcon },
  { kind: "tag", icon: TagIcon },
];

const COLOR_SELECTED: Record<TagChipColor, string> = {
  primary: "border-primary bg-primary/15 text-primary",
  info: "border-info bg-info/15 text-[color:var(--info)]",
  warning: "border-warning bg-warning/20 text-[color:var(--warning-foreground)]",
  success: "border-success bg-success/15 text-[color:var(--success)]",
  violet: "border-violet bg-violet/15 text-[color:var(--violet)]",
  pink: "border-pink bg-pink/15 text-[color:var(--pink)]",
  yellow: "border-yellow bg-yellow/30 text-[color:var(--yellow-foreground)]",
  neutral: "border-border bg-muted text-muted-foreground",
};

export function BroadcastAudience({
  segment,
  onChange,
}: {
  segment: BroadcastSegment;
  onChange: (next: BroadcastSegment) => void;
}) {
  const t = useTranslations("tgInbox.broadcast");
  const [tagDraft, setTagDraft] = React.useState("");
  const tagsQuery = usePatientTags(segment.kind === "tag");

  const selectKind = (kind: AudienceKind) => {
    if (kind === segment.kind) return;
    if (kind === "all") onChange({ kind: "all" });
    else if (kind === "segment") onChange({ kind: "segment", segments: [] });
    else onChange({ kind: "tag", tags: [] });
  };

  const toggleSegment = (s: PatientSegmentKind) => {
    if (segment.kind !== "segment") return;
    const has = segment.segments.includes(s);
    onChange({
      kind: "segment",
      segments: has
        ? segment.segments.filter((x) => x !== s)
        : [...segment.segments, s],
    });
  };

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag || segment.kind !== "tag") return;
    if (segment.tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    onChange({ kind: "tag", tags: [...segment.tags, tag] });
    setTagDraft("");
  };

  const removeTag = (tag: string) => {
    if (segment.kind !== "tag") return;
    onChange({ kind: "tag", tags: segment.tags.filter((x) => x !== tag) });
  };

  const suggestions =
    segment.kind === "tag"
      ? (tagsQuery.data ?? []).filter((s) => !segment.tags.includes(s.tag))
      : [];

  return (
    <div className="space-y-3">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("audience.label")}
      </div>

      {/* Kind selector — segmented control. */}
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
        {KIND_TABS.map(({ kind, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => selectKind(kind)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
              segment.kind === kind
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`audience.kind.${kind}`)}
          </button>
        ))}
      </div>

      {segment.kind === "all" ? (
        <p className="rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5 text-[13px] text-muted-foreground">
          {t("audience.allHint")}
        </p>
      ) : null}

      {segment.kind === "segment" ? (
        <div className="flex flex-wrap gap-1.5">
          {SEGMENT_OPTIONS.map(({ kind, color }) => {
            const selected = segment.segments.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleSegment(kind)}
                aria-pressed={selected}
                className={cn(
                  "rounded-full border px-3 py-1 text-[13px] font-medium transition-colors",
                  selected
                    ? COLOR_SELECTED[color]
                    : "border-border/70 bg-card text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                {t(`audience.segment.${kind}`)}
              </button>
            );
          })}
        </div>
      ) : null}

      {segment.kind === "tag" ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder={t("audience.tagPlaceholder")}
              className="h-9"
            />
            <button
              type="button"
              onClick={() => addTag(tagDraft)}
              disabled={!tagDraft.trim()}
              aria-label={t("audience.addTag")}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <PlusIcon className="size-4" />
            </button>
          </div>

          {segment.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {segment.tags.map((tag) => (
                <TagChip
                  key={tag}
                  label={tag}
                  color="info"
                  onRemove={() => removeTag(tag)}
                />
              ))}
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] text-muted-foreground">
                {t("audience.suggested")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s.tag}
                    type="button"
                    onClick={() => addTag(s.tag)}
                    className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  >
                    <PlusIcon className="size-3" aria-hidden />
                    {s.tag}
                    <span className="text-[10px] opacity-60">{s.count}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
