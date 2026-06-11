/**
 * Ф8 — карта тела: валидация точек (PATCH bodyMap) + печатный SVG.
 *
 * Координаты нормированы 0..1; номера пинов сквозные по всему списку, чтобы
 * легенда под фигурами совпадала с номерами на проекциях.
 */
import { describe, expect, it } from "vitest";

import { renderBodyMapSvg, BODY_SILHOUETTE_MARKUP } from "@/lib/body-map";
import { UpdateVisitNoteSchema } from "@/server/schemas/visit-note";

describe("UpdateVisitNoteSchema.bodyMap", () => {
  it("accepts valid points and empty array", () => {
    expect(
      UpdateVisitNoteSchema.safeParse({
        bodyMap: [
          { x: 0.5, y: 0.2, view: "FRONT", label: "боль" },
          { x: 0, y: 1, view: "BACK" },
        ],
      }).success,
    ).toBe(true);
    expect(UpdateVisitNoteSchema.safeParse({ bodyMap: [] }).success).toBe(true);
  });

  it("rejects out-of-range coordinates", () => {
    expect(
      UpdateVisitNoteSchema.safeParse({
        bodyMap: [{ x: 1.2, y: 0.5, view: "FRONT" }],
      }).success,
    ).toBe(false);
    expect(
      UpdateVisitNoteSchema.safeParse({
        bodyMap: [{ x: 0.5, y: -0.1, view: "FRONT" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown view and oversized label", () => {
    expect(
      UpdateVisitNoteSchema.safeParse({
        bodyMap: [{ x: 0.5, y: 0.5, view: "SIDE" }],
      }).success,
    ).toBe(false);
    expect(
      UpdateVisitNoteSchema.safeParse({
        bodyMap: [{ x: 0.5, y: 0.5, view: "FRONT", label: "x".repeat(121) }],
      }).success,
    ).toBe(false);
  });

  it("caps the list at 40 points", () => {
    const pt = { x: 0.5, y: 0.5, view: "FRONT" as const };
    expect(
      UpdateVisitNoteSchema.safeParse({ bodyMap: Array(40).fill(pt) }).success,
    ).toBe(true);
    expect(
      UpdateVisitNoteSchema.safeParse({ bodyMap: Array(41).fill(pt) }).success,
    ).toBe(false);
  });
});

describe("renderBodyMapSvg", () => {
  const points = [
    { x: 0.5, y: 0.1, view: "FRONT" as const, label: "лоб" },
    { x: 0.3, y: 0.5, view: "BACK" as const },
    { x: 0.6, y: 0.8, view: "FRONT" as const },
  ];

  it("renders the shared silhouette", () => {
    expect(renderBodyMapSvg(points, "FRONT")).toContain(
      BODY_SILHOUETTE_MARKUP,
    );
  });

  it("renders pins only for the requested view, numbering globally", () => {
    const front = renderBodyMapSvg(points, "FRONT");
    // FRONT points are №1 and №3 in the full list — BACK's №2 is skipped.
    expect(front).toContain(">1</text>");
    expect(front).toContain(">3</text>");
    expect(front).not.toContain(">2</text>");
    const back = renderBodyMapSvg(points, "BACK");
    expect(back).toContain(">2</text>");
    expect(back).not.toContain(">1</text>");
  });

  it("maps normalized coordinates into the viewBox", () => {
    const svg = renderBodyMapSvg(
      [{ x: 0.5, y: 0.1, view: "FRONT" }],
      "FRONT",
    );
    expect(svg).toContain(`cx="50.0"`);
    expect(svg).toContain(`cy="20.0"`);
  });

  it("renders no pins for a view without points", () => {
    const svg = renderBodyMapSvg(
      [{ x: 0.5, y: 0.5, view: "FRONT" }],
      "BACK",
    );
    expect(svg).not.toContain("<circle");
  });
});
