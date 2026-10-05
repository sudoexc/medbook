/**
 * Colour fallbacks for Chrome 109 (Windows 7 machines in the clinic, owner
 * report 05.10.2026): postcss-legacy-colors.cjs, its wiring and the brand
 * colour companions the layouts print at runtime.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import { hexToRgbTriplet, legacyColorCompanions } from "@/lib/legacy-color";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const legacy = require("../../postcss-legacy-colors.cjs") as postcss.PluginCreator<void> & {
  parseColor: (v: string) => { r: number; g: number; b: number; a: number } | null;
};

const run = async (css: string) => (await postcss([legacy]).process(css, { from: undefined })).css;
const squash = (s: string) => s.replace(/\s+/g, "");

describe("parseColor", () => {
  it("reads hex, rgb() and oklch()", () => {
    expect(legacy.parseColor("#16c784")).toEqual({ r: 22, g: 199, b: 132, a: 1 });
    expect(legacy.parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(legacy.parseColor("rgba(255, 255, 255, 0.08)")).toEqual({ r: 255, g: 255, b: 255, a: 0.08 });
    expect(legacy.parseColor("rgb(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    // Tailwind's emerald-500, whose documented sRGB fallback is #00bc7d.
    expect(legacy.parseColor("oklch(69.6% .17 162.48)")).toEqual({ r: 0, g: 188, b: 125, a: 1 });
  });

  it("is not fooled by things that are not a plain colour", () => {
    for (const v of ["var(--x)", "calc(1px + 2px)", "0.75rem", "currentcolor", "#12345", "red"]) {
      expect(legacy.parseColor(v), v).toBeNull();
    }
  });
});

describe("the plugin", () => {
  const OPACITY = `
    :root{--brand-primary:#2353ff;--primary:var(--brand-primary);--success:#16c784}
    .dark{--success:#22d39a;--border:rgba(255,255,255,.08)}
    .bg-success\\/10{background-color:var(--success)}
    @supports (color:color-mix(in lab, red, red)){.bg-success\\/10{background-color:color-mix(in oklab, var(--success) 10%, transparent)}}
  `;

  it("gives every colour token its rgb and alpha, in each theme", async () => {
    const out = squash(await run(OPACITY));
    expect(out).toContain("--success:#16c784;--success-rgb:22199132");
    expect(out).toContain("--success-rgb:22199132;--success-a:1");
    expect(out).toContain("--success:#22d39a;--success-rgb:34211154;--success-a:1");
    expect(out).toContain("--border-rgb:255255255;--border-a:0.08");
    // A token that points at another one keeps pointing, so a clinic brand
    // colour set at runtime carries through.
    expect(out).toContain("--primary-rgb:var(--brand-primary-rgb);--primary-a:var(--brand-primary-a)");
  });

  it("twins the color-mix block with an rgb() old Chrome understands", async () => {
    const out = await run(OPACITY);
    expect(squash(out)).toContain(
      squash(`@supports not (color: color-mix(in lab, red, red)){.bg-success\\/10{background-color:rgb(var(--success-rgb) / calc(var(--success-a) * 10%))}}`),
    );
  });

  it("changes nothing a modern browser reads: the original rules stay, in order", async () => {
    const out = squash(await run(OPACITY));
    const originals = [
      ".bg-success\\/10{background-color:var(--success)}",
      "@supports(color:color-mix(inlab,red,red)){.bg-success\\/10{background-color:color-mix(inoklab,var(--success)10%,transparent)}}",
    ];
    const at = originals.map((r) => out.indexOf(r));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // The twin comes after the block it stands in for.
    expect(out.indexOf("@supportsnot")).toBeGreaterThan(at[1]!);
  });

  it("leaves out what it cannot express, so the old fallback keeps applying", async () => {
    const out = await run(`
      :root{--x:#000}
      .shadow{--tw-shadow-color:var(--x)}
      @supports (color:color-mix(in lab, red, red)){.shadow{--tw-shadow-color:color-mix(in oklab, var(--x) var(--tw-shadow-alpha), transparent)}}
      .cc{border-color:currentcolor}
      @supports (color:color-mix(in lab, red, red)){.cc{border-color:color-mix(in oklab, currentcolor 50%, transparent)}}
    `);
    expect(out).not.toContain("@supports not");
  });

  it("literal colours mixed with transparent become rgba()", async () => {
    const out = squash(
      await run(`.a{color:#fff}@supports (color:color-mix(in lab, red, red)){.a{color:color-mix(in srgb, #fff 20%, transparent)}}`),
    );
    expect(out).toContain("@supportsnot(color:color-mix(inlab,red,red)){.a{color:rgba(255,255,255,0.2)}}");
  });

  it("oklch() custom properties get an sRGB twin; plain properties an rgb() copy in front", async () => {
    const out = squash(
      await run(`:root,:host{--color-emerald-500:oklch(69.6% .17 162.48)}.t{color:oklch(69.6% .17 162.48)}`),
    );
    expect(out).toContain("@supportsnot(color:color-mix(inlab,red,red)){:root,:host{--color-emerald-500:rgb(0,188,125)}}");
    expect(out).toContain("--color-emerald-500-rgb:0188125;--color-emerald-500-a:1");
    expect(out).toContain(".t{color:rgb(0,188,125);color:oklch(69.6%.17162.48)}");
  });

  it("gradients drop the interpolation space old Chrome cannot parse", async () => {
    const out = squash(await run(`.bg-gradient-to-br{--tw-gradient-position:to bottom right in oklab}`));
    expect(out).toContain(
      "@supportsnot(color:color-mix(inlab,red,red)){.bg-gradient-to-br{--tw-gradient-position:tobottomright}}",
    );
  });

  it("a name that holds a colour in one rule and not in another does not crash it", async () => {
    const out = await run(`:root{--ring:#2353ff}.x{--ring:initial}.y{--ring:var(--nope)}`);
    expect(squash(out)).toContain(".x{--ring:initial}");
    expect(squash(out)).toContain(".y{--ring:var(--nope)}");
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

  it("runs after Tailwind, passed as the plugin itself", () => {
    const cfg = read("postcss.config.mjs");
    expect(cfg).toContain('import legacyColors from "./postcss-legacy-colors.cjs";');
    expect(cfg).toContain('plugins: ["@tailwindcss/postcss", legacyColors]');
  });

  it("the plugin file reaches the Docker build", () => {
    const ignore = read(".dockerignore").split("\n").map((l) => l.trim());
    expect(ignore).not.toContain("postcss-legacy-colors.cjs");
    expect(ignore).not.toContain("*.cjs");
  });

  it("a clinic brand colour carries its companions", () => {
    expect(hexToRgbTriplet("#2353ff")).toBe("35 83 255");
    expect(hexToRgbTriplet("#25f")).toBe("34 85 255");
    expect(hexToRgbTriplet("red")).toBeNull();
    expect(legacyColorCompanions("--brand-primary", "#0065d1")).toBe(
      "--brand-primary-rgb: 0 101 209;--brand-primary-a: 1;",
    );
    for (const f of ["src/app/[locale]/crm/layout.tsx", "src/app/c/[slug]/my/layout.tsx"]) {
      expect(read(f), f).toContain('legacyColorCompanions("--brand-primary", primary)');
    }
  });

  it("the doctor's patient table drops columns instead of crushing them", () => {
    const table = read("src/app/[locale]/doctor/patients/_components/patients-table.tsx");
    expect(table).toContain('<section className="@container overflow-hidden');
    expect(table).toContain("@min-[1000px]:grid-cols-[minmax(0,1.7fr)_64px_150px_110px_minmax(0,1.4fr)_110px_140px_84px]");
    expect(table).toContain('<div className={WIDE}>{t("table.columns.phone")}</div>');
    expect(table).toContain('<div className={MID}>{t("table.columns.status")}</div>');
  });
});
