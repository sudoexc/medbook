/**
 * P1.1 — conclusion PDF smoke test.
 *
 * pdfkit output is non-deterministic (timestamp + uuid in the trailer), so we
 * assert the `%PDF-` magic + `%%EOF` trailer + a plausible size rather than
 * exact bytes — mirroring `analytics/pdf-formatter.test.ts`. The point is to
 * prove the DejaVuSans registration path works (Cyrillic + Latin-Uzbek render
 * without falling back to Helvetica and crashing) for both locales.
 */
import { describe, expect, it } from "vitest";

import { renderConclusionPdf } from "@/server/visit-notes/conclusion-pdf";

describe("renderConclusionPdf", () => {
  it("emits a PDF starting with %PDF- and ending with %%EOF", async () => {
    const buf = await renderConclusionPdf({
      clinicName: "NeuroFax",
      clinicAddress: "Ташкент, ул. Амира Темура 1",
      clinicPhone: "+998901234567",
      doctorName: "Каримов А.А.",
      patientName: "Иван Иванов",
      visitDateLabel: "7 мая 2026 · 14:30",
      handoutMarkdown:
        "# Рекомендации\n- Пить воду\n- Отдыхать\n\nКонтрольный приём через неделю.",
      locale: "ru",
      generatedAt: new Date("2026-05-07T09:30:00Z"),
      brandColor: "#3DD5C0",
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.subarray(buf.length - 32).toString("ascii")).toContain("%%EOF");
    expect(buf.length).toBeGreaterThan(2_000);
  });

  it("renders the Uzbek-Latin locale without crashing", async () => {
    const buf = await renderConclusionPdf({
      clinicName: "Klinika",
      patientName: "Olimjon Karimov",
      visitDateLabel: "7-may 2026",
      handoutMarkdown: "# Tavsiyalar\n- Ko‘proq suv iching",
      locale: "uz",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(0);
  });

  it("still renders when the handout is empty (defensive, never crashes)", async () => {
    const buf = await renderConclusionPdf({
      clinicName: "X",
      patientName: "Y",
      visitDateLabel: "—",
      handoutMarkdown: "",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("falls back to the brand default for an invalid colour (no throw)", async () => {
    const buf = await renderConclusionPdf({
      clinicName: "X",
      patientName: "Y",
      visitDateLabel: "—",
      handoutMarkdown: "## Тест",
      brandColor: "not-a-color",
    });
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
