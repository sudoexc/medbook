"use client";

import * as React from "react";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  /**
   * `multiline`: a textarea for clinical free text (complaint, diagnosis,
   * notes). A one-line input drops the line breaks from its value, so the
   * first edit of a multi-line complaint saved it as one line (audit PT-23).
   */
  type?: "text" | "tel" | "date" | "select" | "multiline";
  /** Options when `type="select"`. */
  options?: Array<{ value: string; label: string }>;
  /** Allow empty-string to save as null. */
  allowEmpty?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * What a key press does in the editor. On one line Enter saves; in a
 * textarea Enter is a new line and Ctrl/Cmd+Enter saves. Esc cancels both.
 */
export function inlineFieldKeyAction(
  e: { key: string; ctrlKey?: boolean; metaKey?: boolean },
  multiline: boolean,
): "save" | "cancel" | null {
  if (e.key === "Escape") return "cancel";
  if (e.key !== "Enter") return null;
  if (!multiline) return "save";
  return e.ctrlKey || e.metaKey ? "save" : null;
}

/**
 * Single-field inline editor.
 *
 * Display mode: text (or custom node) + a pencil icon on hover.
 * Edit mode: input + Save/Cancel buttons. Enter saves, Esc cancels
 * (`inlineFieldKeyAction`; Ctrl/Cmd+Enter in a multiline field).
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
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(
    null,
  );
  const multiline = type === "multiline";

  React.useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  React.useEffect(() => {
    if (!editing || type === "select") return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (type === "multiline") {
      // Caret at the end, not select-all: one stray key would otherwise
      // replace a whole complaint the doctor only meant to amend.
      el.setSelectionRange(el.value.length, el.value.length);
    } else {
      el.select();
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    const action = inlineFieldKeyAction(e, multiline);
    if (action === null) return;
    e.preventDefault();
    if (action === "save") void commit();
    else cancel();
  };

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
            "flex w-full gap-2 rounded-md px-1 py-0.5 text-left text-sm transition-colors",
            multiline ? "items-start" : "items-center",
            "hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            disabled && "cursor-default opacity-60 hover:bg-transparent",
          )}
        >
          <span
            className={cn(
              "min-w-0 flex-1",
              multiline ? "break-words" : "truncate",
            )}
          >
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
      <div className={cn("flex gap-1", multiline ? "items-start" : "items-center")}>
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
        ) : multiline ? (
          <Textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={4}
            disabled={saving}
          />
        ) : (
          <Input
            ref={inputRef as React.Ref<HTMLInputElement>}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
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
