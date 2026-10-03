/**
 * The reception tablet's wiring: the texts (ru and uz in parity, no dashes,
 * valid ICU), the ways in (CRM menu, the reception page), the page's
 * manifest tags, and the touch rules that are easy to lose in a later edit.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "@formatjs/icu-messageformat-parser";
import { describe, expect, it } from "vitest";

import { ENTERPRISE_FLAGS } from "@/lib/feature-flags";
import { CRM_NAV, getVisibleCrmNav } from "@/components/layout/crm-sidebar";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

type Tree = { [k: string]: string | Tree };

function flatten(node: Tree, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else flatten(v, key, out);
  }
  return out;
}

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const DIR = "src/app/[locale]/crm/reception/tablet";

describe("texts", () => {
  const ruTexts = flatten(ru.receptionTablet as unknown as Tree);
  const uzTexts = flatten(uz.receptionTablet as unknown as Tree);

  it("ru and uz have the same keys", () => {
    expect(Object.keys(uzTexts).sort()).toEqual(Object.keys(ruTexts).sort());
    expect(Object.keys(ruTexts).length).toBeGreaterThan(100);
  });

  it("no dashes in what the receptionist reads", () => {
    const extra = {
      "nav.ru": ru.crmShell.sidebarNav.receptionTablet,
      "nav.uz": uz.crmShell.sidebarNav.receptionTablet,
      "link.ru": ru.reception.tabletMode,
      "link.uz": uz.reception.tabletMode,
    };
    const withDash = [...Object.entries(ruTexts), ...Object.entries(uzTexts), ...Object.entries(extra)].filter(
      ([, v]) => /[—–]/.test(v),
    );
    expect(withDash).toEqual([]);
  });

  it("every text parses as ICU in both languages", () => {
    for (const [k, v] of [...Object.entries(ruTexts), ...Object.entries(uzTexts)]) {
      expect(() => parse(v), k).not.toThrow();
    }
  });

  it("the placeholders are the same in both languages", () => {
    type El = { type: number; value?: unknown; options?: Record<string, { value: El[] }> };
    const collect = (els: El[], out: Set<string>): Set<string> => {
      for (const el of els) {
        // argument, number, date, time, select, plural: a named value.
        if ([1, 2, 3, 4, 5, 6].includes(el.type) && typeof el.value === "string") out.add(el.value);
        for (const o of Object.values(el.options ?? {})) collect(o.value, out);
      }
      return out;
    };
    const args = (s: string) => [...collect(parse(s) as El[], new Set())].sort();
    for (const k of Object.keys(ruTexts)) {
      expect(args(uzTexts[k]!), k).toEqual(args(ruTexts[k]!));
    }
  });

  it("the big actions say what they do", () => {
    expect(ruTexts["home.queueCta"]).toBe("В очередь");
    expect(ruTexts["home.bookCta"]).toBe("Записать на время");
    expect(ruTexts["home.arrivalsTitle"]).toBe("Пришли по записи");
    expect(ruTexts["arrival.arrived"]).toBe("Пришёл");
    expect(uzTexts["arrival.arrived"]).toBe("Keldi");
    expect(ruTexts["done.print"]).toBe("Печать талона");
    expect(ruTexts["done.next"]).toBe("Следующий пациент");
  });
});

describe("ways in", () => {
  it("the CRM menu has the tablet for the desk and the administrator only", () => {
    const item = CRM_NAV.flatMap((g) => g.items).find((i) => i.href === "reception/tablet");
    expect(item?.labelKey).toBe("receptionTablet");
    const hrefs = (role: "ADMIN" | "RECEPTIONIST" | null) =>
      getVisibleCrmNav(ENTERPRISE_FLAGS, role).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs("RECEPTIONIST")).toContain("reception/tablet");
    expect(hrefs("ADMIN")).toContain("reception/tablet");
    expect(hrefs(null)).not.toContain("reception/tablet");
    expect(ru.crmShell.sidebarNav.receptionTablet).toBeTruthy();
    expect(uz.crmShell.sidebarNav.receptionTablet).toBeTruthy();
  });

  it("the reception page links to it", () => {
    const src = read("src/app/[locale]/crm/reception/_components/reception-page-client.tsx");
    expect(src).toContain('href="/crm/reception/tablet"');
    expect(src).toContain('t("tabletMode")');
  });

  it("the page exists, checks the role and links the manifest", () => {
    const page = read(`${DIR}/page.tsx`);
    expect(page).toContain("canUseReceptionTablet(session?.user?.role)");
    expect(page).toContain("receptionTabletManifestUrl(locale)");
    expect(page).toContain("appleWebApp");
    expect(page).toContain('viewportFit: "cover"');
    for (const size of [180, 192, 512]) {
      expect(existsSync(path.join(process.cwd(), `public/reception-tablet/icon-${size}.png`))).toBe(true);
    }
  });
});

describe("touch rules", () => {
  const ui = read(`${DIR}/_components/tablet-ui.tsx`);
  const all = [
    "tablet-app.tsx",
    "tablet-ui.tsx",
    "doctor-tile.tsx",
    "patient-step.tsx",
    "phone-keypad.tsx",
    "doctor-step.tsx",
    "time-step.tsx",
    "confirm-step.tsx",
    "service-chips.tsx",
    "done-screen.tsx",
    "arrivals-list.tsx",
  ].map((f) => read(`${DIR}/_components/${f}`));

  it("controls are at least 56 px tall and never select text on a long press", () => {
    expect(ui).toMatch(/md: "h-14/);
    expect(ui).toContain("select-none touch-manipulation");
  });

  it("no select, dropdown or popover on the tablet: segmented controls and chips instead", () => {
    for (const src of all) {
      expect(src).not.toMatch(/@\/components\/ui\/(select|dropdown-menu|popover)/);
    }
  });

  it("no input below 16 px (Safari would zoom in on focus)", () => {
    for (const src of all) {
      for (const m of src.matchAll(/<input[\s\S]*?className=(?:"([^"]*)"|\{cn\(([\s\S]*?)\)\})/g)) {
        const cls = m[1] ?? m[2] ?? "";
        expect(cls).not.toMatch(/text-(xs|sm|\[1[0-5]px\])/);
      }
    }
  });

  it("no gradients", () => {
    for (const src of all) expect(src).not.toMatch(/gradient/);
  });

  it("the phone field opens the iPad's number pad", () => {
    const keypad = read(`${DIR}/_components/phone-keypad.tsx`);
    expect(keypad).toContain('inputMode="tel"');
  });
});

describe("a ticket or booking in flight", () => {
  const app = read(`${DIR}/_components/tablet-app.tsx`);

  it("locks the header's «Назад», «Отмена», the step pills and «Обычный режим»", () => {
    expect(app).toContain("<FlowHeader\n              flow={active}\n              locked={pending}");
    expect(app).toContain("onClick={onBack} disabled={locked}");
    expect(app).toMatch(/onClick=\{onCancel\}\s+disabled=\{locked\}/);
    expect(app).toContain("const reachable = !locked && !isCurrent");
    expect(app).toContain("locked={pending} />");
    // «Изменить» and the service chips of the confirm screen.
    expect(app).toContain("<fieldset disabled={pending}");
  });

  it("stamps every server answer with the flow that sent it", () => {
    for (const type of ["done", "ownerQuestion", "patientCreated", "bookingUnsure"]) {
      const sent = [...app.matchAll(new RegExp(`type: "${type}"[^}]*`, "g"))].map((m) => m[0]);
      expect(sent.length, type).toBeGreaterThan(0);
      for (const s of sent) expect(s, type).toContain("flowId");
    }
    expect(app).toContain("if (!isCurrentFlow(flowId))");
  });

  it("the booking's «Записать» says it checks first after a lost answer", () => {
    expect(app).toContain('t("submitBookCheck")');
    expect(ru.receptionTablet.confirm.errors.bookingUnsure).not.toMatch(/нажмите ещё раз/i);
  });
});

describe("the new patient form", () => {
  const src = read(`${DIR}/_components/patient-step.tsx`);

  it("dials the phone on the same on-screen keypad as the search", () => {
    expect(src).toMatch(/<PhoneKeypad\s+fieldId="tablet-new-phone"/);
    expect(src).toMatch(/<PhoneKeypad\s+fieldId="tablet-phone-search"/);
  });
});
