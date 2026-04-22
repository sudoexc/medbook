"use client";

import * as React from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface InlineFieldProps {
  label?: string;
  /** Rendered representation (string or ReactNode) when not editing. */
  display: React.ReactNode;
  /** Current raw value that goes into the input. */
  value: string | null | undefined;
  onSave: (next: string | null) => Promise<void> | void;
  placeholder?: string;
  type?: "text" | "tel" | "date" | "select";
  /** Options when `type="select"`. */
  options?: Array<{ value: string; label: string }>;
  /** Allow empty-string to save as null. */
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Single-field inline editor.
 *
 * Display mode: text (or custom node) + a pencil icon on hover.
 * Edit mode: input + Save/Cancel buttons. Enter saves, Esc cancels.
 *
 * Save happens via the supplied `onSave` callback — page-level mutations
 * handle optimistic updates and toast on error, so this component stays
 * dumb (just UX for one field).
 */
export function InlineField({
  label,
  display,
  value,
  onSave,
  placeholder,
  type = "text",
  options,
  allowEmpty = true,
  disabled = false,
  className,
}: InlineFieldProps) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(value ?? "");
  const [saving, setSaving] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  React.useEffect(() => {
    if (editing && type !== "select") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, type]);

  const cancel = React.useCallback(() => {
    setDraft(value ?? "");
    setEditing(false);
  }, [value]);

  const commit = React.useCallback(async () => {
    const trimmed = draft.trim();
    const next = trimmed === "" ? (allowEmpty ? null : value ?? null) : trimmed;
    if ((next ?? "") === (value ?? "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave, allowEmpty]);

  if (!editing) {
    return (
      <div className={cn("group flex flex-col gap-0.5", className)}>
        {label ? (
          <Label className="text-xs font-normal text-muted-foreground">
            {label}
          </Label>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => setEditing(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm transition-colors",
            "hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            disabled && "cursor-default opacity-60 hover:bg-transparent",
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {display || (
              <span className="text-muted-foreground">
                {placeholder ?? "—"}
              </span>
            )}
          </span>
          {!disabled ? (
            <PencilIcon className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {label ? (
        <Label className="text-xs font-normal text-muted-foreground">
          {label}
        </Label>
      ) : null}
      <div className="flex items-center gap-1">
        {type === "select" ? (
          <Select
            value={draft || ""}
            onValueChange={(v) => setDraft(v)}
          >
            <SelectTrigger className="h-8">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {(options ?? []).map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            type={type}
            placeholder={placeholder}
            className="h-8"
            disabled={saving}
          />
        )}
        <button
          type="button"
          onClick={() => void commit()}
          disabled={saving}
          aria-label="Save"
          className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          <CheckIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          aria-label="Cancel"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
