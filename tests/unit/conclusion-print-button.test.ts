/**
 * The doctor's conclusion printing (owner report 09.10.2026): no «Печать»
 * button, the right-click print took the CRM page around the preview
 * (three sheets), and the diagnoses and prescriptions were small.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const route = read("src/app/api/crm/visit-notes/[id]/print/route.ts");

describe("one press prints the sheet alone", () => {
  it("a hidden frame loads the sheet with ?autoprint=1", () => {
    const helper = read("src/components/visit/print-conclusion.ts");
    expect(helper).toContain('new URLSearchParams({ autoprint: "1" })');
    expect(helper).toContain('document.createElement("iframe")');
    expect(route).toContain("${autoprint ? AUTOPRINT_SCRIPT : \"\"}");
  });

  it("the buttons: the action bar, the preview, the patient card", () => {
    const base = "src/app/[locale]/doctor/reception/_components/";
    expect(read(base + "visit-action-bar.tsx")).toContain('onClick={() => void openPreview("print")}');
    expect(read(base + "conclusion-preview-dialog.tsx")).toContain("onClick={() => printConclusion(noteId)}");
    const card = read(base + "active-patient-card.tsx");
    expect(card).toContain("printConclusion(visitNoteId);");
    expect(card).toContain('printConclusion(visitNoteId, "package");');
    expect(card).not.toContain("window.open(");
  });
});

describe("the sheet", () => {
  it("the margin is set once: @page, not again as padding on paper", () => {
    expect(route).not.toMatch(/@media print \{[^}]*\.page \{ margin: 0; padding: 16mm/);
    expect(route.match(/\.page \{ margin: 0; padding: 0; max-width: none; \}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("diagnoses and prescriptions print larger than the rest", () => {
    expect(route).toContain('<section class="block block-dx">');
    expect(route).toContain('<section class="block block-rx">');
    // The diagnosis is the largest, the prescriptions follow in the same bold
    // black one step smaller, one per line (doctor 10.10.2026).
    expect(route).toMatch(
      /section\.block-dx > div \{\s*font-size: 19px;\s*font-weight: 700;\s*color: #000;/,
    );
    expect(route).toMatch(/section\.block-rx \.chips \{\s*display: block;/);
    expect(route).toMatch(
      /section\.block-rx \.chips li \{[^}]*font-size: 16px;\s*font-weight: 700;\s*color: #000;/,
    );
  });
});
