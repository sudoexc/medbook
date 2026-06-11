"use client";

/**
 * Ф8 — карта тела в секции осмотра. Клик по фигуре ставит точку, клик по
 * пину открывает мини-редактор (подпись/удалить). Сохранение — replace-all
 * в VisitNote.bodyMap, как и у назначений. Без дерматомных оверлеев в v1.
 */
import * as React from "react";
import { useTranslations } from "next-intl";
import { PersonStandingIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { BODY_MAP_VIEWBOX, BODY_SILHOUETTE_MARKUP } from "@/lib/body-map";

import type { BodyMapPoint, BodyMapView } from "../_hooks/use-visit-note";

const MAX_POINTS = 40;

export function BodyMapCard({
  points,
  disabled,
  onChange,
}: {
  points: BodyMapPoint[];
  disabled: boolean;
  onChange: (next: BodyMapPoint[]) => void;
}) {
  const t = useTranslations("doctor.reception");
  const [open, setOpen] = React.useState(points.length > 0);
  const [view, setView] = React.useState<BodyMapView>("FRONT");
  const [selected, setSelected] = React.useState<number | null>(null);
  const [labelDraft, setLabelDraft] = React.useState("");

  React.useEffect(() => {
    if (points.length > 0) setOpen(true);
  }, [points.length]);

  React.useEffect(() => {
    setLabelDraft(
      selected != null ? (points[selected]?.label ?? "") : "",
    );
  }, [selected, points]);

  if (disabled && points.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 w-fit items-center gap-1 rounded-md border border-dashed border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <PersonStandingIcon className="size-3" />
        {t("bodyMap.open")}
      </button>
    );
  }

  const { width, height } = BODY_MAP_VIEWBOX;

  const addPoint = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled || points.length >= MAX_POINTS) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const next = [
      ...points,
      {
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        view,
      },
    ];
    onChange(next);
    setSelected(next.length - 1);
  };

  const commitLabel = () => {
    if (selected == null || !points[selected]) return;
    const v = labelDraft.trim();
    if (v === (points[selected].label ?? "")) return;
    onChange(
      points.map((p, i) =>
        i === selected ? { ...p, label: v || undefined } : p,
      ),
    );
  };

  const removeSelected = () => {
    if (selected == null) return;
    onChange(points.filter((_, i) => i !== selected));
    setSelected(null);
  };

  const selectedPoint = selected != null ? points[selected] : null;

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1.5">
          <span className="inline-flex size-5 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PersonStandingIcon className="size-3" />
          </span>
          <span className="text-xs font-semibold text-foreground">
            {t("bodyMap.title")}
          </span>
          {points.length > 0 && (
            <span className="rounded-md bg-muted px-1 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {points.length}
            </span>
          )}
        </div>
        <div className="inline-flex items-center gap-1">
          {(["FRONT", "BACK"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setView(v);
                setSelected(null);
              }}
              className={cn(
                "inline-flex h-6 items-center rounded-md border px-1.5 text-[11px] font-medium transition-colors",
                view === v
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t(v === "FRONT" ? "bodyMap.front" : "bodyMap.back")}
            </button>
          ))}
          {points.length === 0 && !disabled && (
            <button
              type="button"
              aria-label={t("bodyMap.close")}
              onClick={() => setOpen(false)}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-start gap-3">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          onClick={addPoint}
          className={cn(
            "h-52 w-[104px] shrink-0 rounded-lg border border-border bg-card text-muted-foreground/25",
            !disabled && "cursor-crosshair",
          )}
        >
          <g
            stroke="currentColor"
            strokeWidth="0.8"
            fill="currentColor"
            // Статичная константа из src/lib/body-map.ts — общая с печатью.
            dangerouslySetInnerHTML={{ __html: BODY_SILHOUETTE_MARKUP }}
          />
          {points.map((p, i) =>
            p.view === view ? (
              <g
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) setSelected(i === selected ? null : i);
                }}
                className={disabled ? undefined : "cursor-pointer"}
              >
                <circle
                  cx={p.x * width}
                  cy={p.y * height}
                  r={selected === i ? 5.4 : 4.6}
                  className={cn(
                    "fill-destructive stroke-white",
                    selected === i && "stroke-2",
                  )}
                  strokeWidth={1.1}
                />
                <text
                  x={p.x * width}
                  y={p.y * height}
                  dy="2.4"
                  textAnchor="middle"
                  fontSize="6.4"
                  fontWeight="700"
                  className="pointer-events-none fill-white"
                >
                  {i + 1}
                </text>
              </g>
            ) : null,
          )}
        </svg>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {points.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t("bodyMap.hint")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {points.map((p, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      setView(p.view);
                      setSelected(i === selected ? null : i);
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md border px-1.5 py-1 text-left text-[11px] transition-colors",
                      selected === i
                        ? "border-primary/40 bg-primary/5"
                        : "border-transparent hover:bg-muted/60",
                    )}
                  >
                    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="truncate text-foreground">
                      {p.label || t("bodyMap.noLabel")}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
                      {t(p.view === "FRONT" ? "bodyMap.front" : "bodyMap.back")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selectedPoint && !disabled && (
            <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border bg-card p-1.5">
              <input
                value={labelDraft}
                autoFocus
                maxLength={120}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitLabel();
                    setSelected(null);
                  } else if (e.key === "Escape") {
                    setSelected(null);
                  }
                }}
                placeholder={t("bodyMap.labelPlaceholder")}
                className="h-6 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                aria-label={t("bodyMap.removePoint")}
                onClick={removeSelected}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2Icon className="size-3" />
              </button>
            </div>
          )}

          {!disabled && points.length > 0 && (
            <p className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <PlusIcon className="size-2.5" />
              {t("bodyMap.hint")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
