/**
 * Open pages reload themselves after a deploy (owner request 09.10.2026),
 * at a safe moment only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("the build the server runs", () => {
  it("/api/version answers the build id, uncached", () => {
    const api = read("src/app/api/version/route.ts");
    expect(api).toContain('path.join(process.cwd(), ".next", "BUILD_ID")');
    expect(api).toContain('"Cache-Control": "no-store"');
  });
});

describe("the watcher", () => {
  const w = read("src/components/version-watch.tsx");

  it("reloads only when stale and safe: idle, no focused field, no dialog, nothing blocking", () => {
    expect(w).toContain("else if (build !== loaded) stale = true;");
    expect(w).toContain("if (stale && safe()) window.location.reload();");
    expect(w).toContain("Date.now() - lastInput < idleMs");
    expect(w).toContain("/^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)");
    expect(w).toContain(`document.querySelector('[role="dialog"], [role="alertdialog"]')`);
    // A dev server never reloads itself.
    expect(w).toContain('if (!build || build === "dev") return;');
  });

  it("mounted in the CRM, the doctor's cabinet and the TVs (not while a TV calls)", () => {
    expect(read("src/app/[locale]/crm/layout.tsx")).toContain("<VersionWatch />");
    expect(read("src/app/[locale]/doctor/layout.tsx")).toContain("<VersionWatch />");
    expect(read("src/app/tv/layout.tsx")).toContain('<VersionWatch idleMs={0} blockSelector="[data-call-takeover]" />');
    expect(read("src/app/tv/_shared.tsx")).toContain("data-call-takeover");
  });
});
