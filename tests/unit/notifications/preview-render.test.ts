/**
 * Phase 8b — live preview render uses the same engine as production.
 *
 * The Settings UI shows a live preview while the admin types. We assert
 * that the engine substitutes our sample contexts correctly across all
 * triggers covered by ALLOWED_KEYS_BY_TRIGGER.
 */
import { describe, it, expect } from "vitest";

import { previewContextFor } from "@/app/[locale]/crm/settings/notifications/_components/preview-context";
import { render, ALLOWED_KEYS_BY_TRIGGER } from "@/server/notifications/template";
import type { LogicalTriggerKey } from "@/server/notifications/rules";

const TRIGGERS: LogicalTriggerKey[] = [
  "appointment.created",
  "appointment.reminder-24h",
  "appointment.reminder-2h",
  "appointment.cancelled",
  "birthday",
  "no-show",
  "payment.due",
];

describe("preview render", () => {
  it("substitutes patient.firstName + clinic.name in RU sample", () => {
    const ctx = previewContextFor("appointment.created", "ru");
    const out = render(
      "Здравствуйте, {{patient.firstName}}! Ждём в {{clinic.name}}.",
      ctx,
    );
    expect(out).toContain("Анна");
    expect(out).toContain("NeuroFax");
  });

  it("substitutes patient.firstName in UZ sample", () => {
    const ctx = previewContextFor("birthday", "uz");
    const out = render("Tabriklaymiz, {{patient.firstName}}!", ctx);
    expect(out).toBe("Tabriklaymiz, Anna!");
  });

  it("renders every whitelisted placeholder for every trigger without throwing", () => {
    for (const tk of TRIGGERS) {
      const allowed = ALLOWED_KEYS_BY_TRIGGER[tk] ?? [];
      const ctx = previewContextFor(tk, "ru");
      const tmpl = allowed.map((k) => `{{${k}}}`).join(" | ");
      const out = render(tmpl, ctx);
      expect(out, `${tk}: missing render output`).not.toBe("");
      // If everything substituted, output must NOT contain leftover {{
      expect(out, `${tk}: leftover placeholder`).not.toContain("{{");
    }
  });

  it("escapes HTML in patient.name (defense-in-depth)", () => {
    const ctx = { patient: { name: "<b>X</b>" } };
    const out = render("Hi {{patient.name}}", ctx);
    expect(out).toBe("Hi &lt;b&gt;X&lt;/b&gt;");
  });
});
