/**
 * Audit UX-01 data fix: mock AI text written into medical records.
 *
 * AI is paused (`AI_ENABLED = false`), but the server kept running the AI
 * pipelines. Every open of a patient's visit history queued an LLM job, and
 * with no provider key the LLM proxy fell back to its mock provider and
 * stored «[mock-llm: mock] Пациент: …» as the patient's summary
 * (`Patient.summaryCache`, also exported to the patient in a DSAR bundle).
 * A doctor's Telegram voice note overwrote the open case's SOAP draft
 * (`MedicalCase.soapDraft`) with «[mock-transcript ru] Пациент жалуется на
 * головную боль.». The server now refuses both while AI is paused; this
 * script removes what was already written.
 *
 *   - Patient.summaryCache containing «[mock-»: summary and its timestamp
 *     cleared (the card then shows no summary, which is the truth).
 *   - MedicalCase.soapDraft (encrypted at rest, decrypted here) containing
 *     «[mock-transcript» or «[mock-llm»: draft cleared. A draft a doctor
 *     wrote or edited by hand without such a marker is left alone.
 *
 * A real LLM or Whisper answer never contains these markers: they are the
 * literal prefixes of `invokeMock` in src/server/ai/llm.ts and
 * src/server/ai/transcribe.ts.
 *
 * Dry run (default, writes nothing):
 *   docker compose exec -T worker npx tsx scripts/fix-ux01-ai-mock-text.ts
 * Apply:
 *   docker compose exec -T -e APPLY=1 worker npx tsx scripts/fix-ux01-ai-mock-text.ts
 *
 * Needs the field-encryption key env (the worker container has it) to read
 * soapDraft. Idempotent: a cleared row no longer matches.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { decryptField, isEncryptedField } from "../src/server/crypto/field-cipher";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

const APPLY = process.env.APPLY === "1";

const SUMMARY_MARKER = "[mock-";
const SOAP_MARKERS = ["[mock-transcript", "[mock-llm"];

function preview(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 60);
}

async function clearSummaries(): Promise<number> {
  const rows = await prisma.patient.findMany({
    where: { summaryCache: { contains: SUMMARY_MARKER } },
    select: { id: true, clinicId: true, summaryCache: true, summaryCacheUpdatedAt: true },
    orderBy: { summaryCacheUpdatedAt: "asc" },
  });
  console.log(`┌─ Patient.summaryCache with mock text: ${rows.length}`);
  for (const r of rows) {
    const at = r.summaryCacheUpdatedAt?.toISOString().slice(0, 16) ?? "?";
    console.log(`│  ${at} ${r.id}: ${preview(r.summaryCache ?? "")}`);
  }
  if (!APPLY || rows.length === 0) return rows.length;
  const res = await prisma.patient.updateMany({
    where: {
      id: { in: rows.map((r) => r.id) },
      summaryCache: { contains: SUMMARY_MARKER },
    },
    data: { summaryCache: null, summaryCacheUpdatedAt: null },
  });
  console.log(`│  cleared: ${res.count}`);
  return rows.length;
}

async function clearSoapDrafts(): Promise<number> {
  const rows = await prisma.medicalCase.findMany({
    where: { soapDraft: { not: null } },
    select: { id: true, clinicId: true, updatedAt: true, soapDraft: true },
    orderBy: { updatedAt: "asc" },
  });
  const mock: Array<{ id: string; stored: string; text: string; updatedAt: Date }> = [];
  let unreadable = 0;
  for (const r of rows) {
    const stored = r.soapDraft ?? "";
    let text: string;
    try {
      text = isEncryptedField(stored) ? (decryptField(stored) ?? "") : stored;
    } catch {
      unreadable += 1;
      continue;
    }
    if (SOAP_MARKERS.some((m) => text.includes(m))) {
      mock.push({ id: r.id, stored, text, updatedAt: r.updatedAt });
    }
  }
  console.log(
    `├─ MedicalCase.soapDraft with mock text: ${mock.length} of ${rows.length}` +
      (unreadable > 0 ? ` (${unreadable} could not be decrypted, left alone)` : ""),
  );
  for (const m of mock) {
    console.log(`│  ${m.updatedAt.toISOString().slice(0, 16)} ${m.id}: ${preview(m.text)}`);
  }
  if (!APPLY) return mock.length;
  let cleared = 0;
  for (const m of mock) {
    // Only if the draft is still the mock one we read: a doctor may be
    // editing the case right now.
    const res = await prisma.medicalCase.updateMany({
      where: { id: m.id, soapDraft: m.stored },
      data: { soapDraft: null },
    });
    cleared += res.count;
  }
  console.log(`│  cleared: ${cleared}`);
  return mock.length;
}

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"}: mock AI text in medical records`);
  const summaries = await clearSummaries();
  const drafts = await clearSoapDrafts();
  console.log(
    `└─ ${APPLY ? "done" : "would clear"}: ${summaries} summaries, ${drafts} SOAP drafts` +
      (APPLY ? "" : ". Nothing written; run again with APPLY=1"),
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
