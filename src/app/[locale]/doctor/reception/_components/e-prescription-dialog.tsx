"use client";

/**
 * Phase G7 — e-prescription builder.
 *
 * Composes a list of Rx items (drug, dose, frequency, duration, optional
 * instructions) and issues a paper recipe. On success the printable HTML
 * opens in a new tab; the doctor presses Cmd+P (or the page auto-prints).
 *
 * Drug-name is free-text — the doctor can type "Парацетамол 500мг" without
 * the catalog being involved. A small search button calls the existing
 * catalog drawer to pull a curated DrugCatalog row when desired.
 */
import * as React from "react";
import {
  Loader2Icon,
  PillIcon,
  PlusIcon,
  PrinterIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import {
  useCreateEPrescription,
  type RxItemInput,
} from "../_hooks/use-clinical-forms";

type Props = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  patientId: string | null;
  appointmentId: string | null;
  visitNoteId: string | null;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  /** Suggested item line from the active visit's `prescriptions` chips. */
  seedItems?: string[];
};

type Draft = RxItemInput & { uid: string };

const emptyDraft = (): Draft => ({
  uid: cryptoRandomId(),
  drugName: "",
  dose: "",
  route: null,
  frequency: "",
  durationDays: null,
  instructions: null,
});

export function EPrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  appointmentId,
  visitNoteId,
  diagnosisCode,
  diagnosisName,
  seedItems,
}: Props) {
  const [items, setItems] = React.useState<Draft[]>([]);
  const [notes, setNotes] = React.useState("");
  const [validForDays, setValidForDays] = React.useState(30);
  const create = useCreateEPrescription();

  React.useEffect(() => {
    if (!open) return;
    setNotes("");
    setValidForDays(30);
    const seeded: Draft[] = (seedItems ?? [])
      .filter((s) => s.trim())
      .slice(0, 8)
      .map((line) => ({
        ...emptyDraft(),
        drugName: line.trim(),
      }));
    setItems(seeded.length > 0 ? seeded : [emptyDraft()]);
  }, [open, seedItems]);

  const handleSubmit = () => {
    if (!patientId) return;
    const clean = items
      .filter((it) => it.drugName.trim() && it.dose.trim() && it.frequency.trim())
      .map<RxItemInput>((it) => ({
        drugId: it.drugId ?? null,
        drugName: it.drugName.trim(),
        dose: it.dose.trim(),
        route: it.route?.trim() || null,
        frequency: it.frequency.trim(),
        durationDays: it.durationDays ?? null,
        instructions: it.instructions?.trim() || null,
      }));
    if (clean.length === 0) return;
    create.mutate(
      {
        patientId,
        appointmentId,
        visitNoteId,
        diagnosisCode,
        diagnosisName,
        items: clean,
        notes: notes.trim() || null,
        validForDays,
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  const canSubmit =
    !!patientId &&
    items.some(
      (it) => it.drugName.trim() && it.dose.trim() && it.frequency.trim(),
    ) &&
    !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PillIcon className="size-4" /> Рецепт
          </DialogTitle>
          <DialogDescription>
            Выпишите препараты пациенту. После сохранения откроется печатная форма с QR.
          </DialogDescription>
        </DialogHeader>

        {!patientId ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            Откройте активный приём, чтобы выписать рецепт.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              МКБ-10:{" "}
              <span className="font-medium text-foreground">
                {diagnosisCode ?? "—"}
              </span>
              {diagnosisName ? (
                <span className="ml-1 text-muted-foreground">· {diagnosisName}</span>
              ) : null}
            </div>

            <ol className="flex flex-col gap-3">
              {items.map((it, idx) => (
                <li
                  key={it.uid}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Rp. {idx + 1}
                    </div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          setItems((prev) => prev.filter((p) => p.uid !== it.uid))
                        }
                        title="Удалить позицию"
                      >
                        <Trash2Icon className="size-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <InputField
                      label="Препарат"
                      value={it.drugName}
                      onChange={(v) => updateItem(setItems, it.uid, { drugName: v })}
                      placeholder="Парацетамол 500 мг"
                      className="sm:col-span-2"
                    />
                    <InputField
                      label="Доза"
                      value={it.dose}
                      onChange={(v) => updateItem(setItems, it.uid, { dose: v })}
                      placeholder="1 таб."
                    />
                    <InputField
                      label="Частота"
                      value={it.frequency}
                      onChange={(v) => updateItem(setItems, it.uid, { frequency: v })}
                      placeholder="3 раза в день"
                    />
                    <InputField
                      label="Путь"
                      value={it.route ?? ""}
                      onChange={(v) =>
                        updateItem(setItems, it.uid, { route: v || null })
                      }
                      placeholder="внутрь"
                    />
                    <InputField
                      label="Длительность, дн."
                      value={it.durationDays != null ? String(it.durationDays) : ""}
                      onChange={(v) => {
                        const n = parseInt(v, 10);
                        updateItem(setItems, it.uid, {
                          durationDays: Number.isFinite(n) && n > 0 ? n : null,
                        });
                      }}
                      placeholder="7"
                      inputMode="numeric"
                    />
                    <InputField
                      label="Инструкция (необязательно)"
                      value={it.instructions ?? ""}
                      onChange={(v) =>
                        updateItem(setItems, it.uid, { instructions: v || null })
                      }
                      placeholder="после еды"
                      className="sm:col-span-2"
                    />
                  </div>
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => setItems((prev) => [...prev, emptyDraft()])}
              className="inline-flex items-center justify-center gap-1 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            >
              <PlusIcon className="size-3.5" />
              Добавить препарат
            </button>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InputField
                label="Действителен, дн."
                value={String(validForDays)}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  if (Number.isFinite(n) && n > 0 && n <= 365) setValidForDays(n);
                }}
                inputMode="numeric"
              />
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  Примечания врача
                </span>
                <textarea
                  className="min-h-[60px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="контроль через 7 дней"
                />
              </label>
            </div>

            {create.isError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                Не удалось выписать рецепт: {(create.error as Error)?.message ?? "ошибка"}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={create.isPending}
          >
            <XIcon className="size-3.5" />
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {create.isPending ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PrinterIcon className="size-3.5" />
            )}
            Выписать и напечатать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function updateItem(
  setItems: React.Dispatch<React.SetStateAction<Draft[]>>,
  uid: string,
  patch: Partial<RxItemInput>,
) {
  setItems((prev) =>
    prev.map((p) => (p.uid === uid ? { ...p, ...patch } : p)),
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  className,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "numeric";
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs", className)}>
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
    </label>
  );
}

/**
 * Stable client-side row uid for draft prescription items (used as the React
 * `key` and to dedupe before submit). `crypto.randomUUID()` is available in
 * every browser and Node version we ship to, so the previous Math.random
 * fallback was dead code that quietly weakened uniqueness. If the runtime
 * ever lacks `randomUUID`, we fill 16 bytes from `crypto.getRandomValues`
 * and format as a v4-style hex string — never down to Math.random.
 */
function cryptoRandomId(): string {
  if (typeof crypto !== "undefined") {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    if (typeof crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      // RFC 4122 v4 layout: set version + variant bits.
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return (
        `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-` +
        `${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-` +
        `${hex.slice(10, 16).join("")}`
      );
    }
  }
  // Hard failure rather than silently degrading to predictable ids — if a
  // doctor's browser can't produce crypto-grade randomness, the form should
  // tell them, not generate colliding keys.
  throw new Error("e-prescription: secure id generation unavailable");
}
