"use client";

import * as React from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import { TagChip } from "@/components/atoms/tag-chip";

export interface TagEditorProps {
  tags: string[];
  onChange: (next: string[]) => void | Promise<void>;
  disabled?: boolean;
  className?: string;
}

/**
 * Inline chip list with add/remove. Commit on blur/Enter; empty chip list
 * is fine.
 *
 * Parent owns the save call — this component just reports the next array.
 */
export function TagEditor({
  tags,
  onChange,
  disabled,
  className,
}: TagEditorProps) {
  const t = useTranslations("patientCard.header");
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const commit = async () => {
    const clean = draft.trim();
    setDraft("");
    setAdding(false);
    if (!clean) return;
    if (tags.includes(clean)) return;
    await onChange([...tags, clean]);
  };

  const remove = async (tag: string) => {
    await onChange(tags.filter((x) => x !== tag));
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {tags.length === 0 && !adding ? (
        <span className="text-xs text-muted-foreground">{t("noTags")}</span>
      ) : null}
      {tags.map((tag) => (
        <TagChip
          key={tag}
          label={tag}
          color="info"
          onRemove={disabled ? undefined : () => void remove(tag)}
        />
      ))}
      {adding ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setAdding(false);
              setDraft("");
            }
          }}
          onBlur={() => void commit()}
          placeholder="tag"
          className="h-6 w-24 rounded-full border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
      ) : !disabled ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Add tag"
        >
          <PlusIcon className="size-3" />
          tag
        </button>
      ) : null}
    </div>
  );
}

/** Unused (chips already include the X icon) — export for potential reuse. */
export function TagRemoveIcon() {
  return <XIcon className="size-3" />;
}
