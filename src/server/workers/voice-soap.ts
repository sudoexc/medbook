/**
 * Phase 15 Wave 5 — Voice → SOAP worker.
 *
 * Job shape:
 *   { clinicId, userId, doctorId, caseId, fileUrl, durationSec }
 *
 * Pipeline:
 *   1. `transcribe(...)` — Whisper. Audio is fetched once, never persisted.
 *   2. Load patient + case context from DB (under SYSTEM tenant scope).
 *   3. `structureSoap(...)` — LLM proxy splits transcript into SOAP sections.
 *   4. Stitch the four sections back into markdown and write
 *      `MedicalCase.soapDraft`. **Overwrite policy**: we always overwrite.
 *      Append/diff between drafts is over-engineering for Wave 5; the doctor
 *      reviews + edits + saves in CRM, so the draft is ephemeral by design.
 *   5. Audit `VOICE_SOAP_DRAFTED` on `MedicalCase`.
 *   6. Publish `case.soap-draft.refreshed` SSE event so the open case page
 *      surfaces the new draft without a refresh.
 *
 * Failures: when transcribe or structuring throws, we log + skip the
 * draft write. The Whisper / LLM proxy will have already written a
 * failure `LLMUsage` row (errorCode populated), so the dashboard sees it.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";

import { transcribe } from "@/server/ai/transcribe";
import { structureSoap, stitchSoapMarkdown } from "@/server/ai/soap";
import { serializeMedicalCaseForWrite } from "@/server/medical-case/cipher-fields";
import { getQueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";

export const QUEUE_NAME = "ai:voice-soap";
export const JOB_NAME = "voice-soap-process";

export type VoiceSoapJob = {
  clinicId: string;
  userId: string;
  doctorId: string;
  caseId: string;
  fileUrl: string;
  durationSec: number;
};

async function loadCaseContext(
  caseId: string,
): Promise<{
  clinicId: string;
  patientFullName: string;
  patientBirthYear: number | null;
  locale: "ru" | "uz";
} | null> {
  const row = await prisma.medicalCase.findUnique({
    where: { id: caseId },
    select: {
      clinicId: true,
      patient: {
        select: {
          fullName: true,
          birthDate: true,
        },
      },
    },
  });
  if (!row) return null;
  const birthYear = row.patient.birthDate
    ? row.patient.birthDate.getFullYear()
    : null;
  // No locale on Patient — default to ru (matches `summary.ts` / patient
  // card UI defaults). The doctor can re-locale via UI later.
  return {
    clinicId: row.clinicId,
    patientFullName: row.patient.fullName,
    patientBirthYear: birthYear,
    locale: "ru",
  };
}

export async function process(job: VoiceSoapJob): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const ctx = await loadCaseContext(job.caseId);
    if (!ctx) {
      console.warn(`[voice-soap] case ${job.caseId} not found — skipping`);
      return;
    }

    // 1) Transcribe. Audio bytes are fetched + transcribed + dropped — the
    //    URL itself is also discarded (we never store it).
    let transcript: string;
    let transcribeCostUzs = 0;
    let language: "ru" | "uz" | "unknown" = "unknown";
    try {
      const t = await transcribe({
        fileUrl: job.fileUrl,
        durationSec: job.durationSec,
        language: "auto",
        clinicId: job.clinicId,
        userId: job.userId,
      });
      transcript = t.text;
      transcribeCostUzs = t.costUzs;
      language = t.language;
    } catch (err) {
      console.error(`[voice-soap] transcribe failed: ${(err as Error).message}`);
      return;
    }

    // 2) Structure SOAP. The LLM proxy redacts the patient name from both
    //    transcript (user content) and response.
    const structured = await structureSoap({
      clinicId: job.clinicId,
      userId: job.userId,
      caseId: job.caseId,
      transcriptText: transcript,
      patientContext: {
        fullName: ctx.patientFullName,
        birthYear: ctx.patientBirthYear,
      },
      locale: ctx.locale,
    });

    // Empty raw → the LLM proxy short-circuited (rate limit / error). Skip
    // the write so we don't overwrite an existing draft with nothing.
    if (!structured.raw) {
      console.warn(
        `[voice-soap] structureSoap returned empty for case ${job.caseId}`,
      );
      return;
    }

    const markdown = stitchSoapMarkdown({
      subjective: structured.subjective,
      objective: structured.objective,
      assessment: structured.assessment,
      plan: structured.plan,
    });

    // 3) Overwrite the draft. (Append/diff is intentional non-goal — see
    //    file header.) `soapDraft` is encrypted at rest — the boundary helper
    //    swaps the markdown for ciphertext.
    await prisma.medicalCase.update({
      where: { id: job.caseId },
      data: serializeMedicalCaseForWrite({ soapDraft: markdown }),
    });

    // 4) Audit row. `LLM_CALL` rows already track per-step cost; this is
    //    the high-level "voice draft was produced" event.
    try {
      await prisma.auditLog.create({
        data: {
          clinicId: job.clinicId,
          actorId: job.userId,
          actorRole: null,
          actorLabel: "voice-soap-worker",
          action: AUDIT_ACTION.VOICE_SOAP_DRAFTED,
          entityType: "MedicalCase",
          entityId: job.caseId,
          meta: {
            doctorId: job.doctorId,
            durationSec: job.durationSec,
            transcribeCostUzs,
            structureCostUzs: structured.costUzs,
            totalCostUzs: transcribeCostUzs + structured.costUzs,
            language,
          },
        },
      });
    } catch (err) {
      console.error("[voice-soap:audit]", err);
    }

    // 5) Realtime fan-out — open case page refetches.
    publishEventSafe(job.clinicId, {
      type: "case.soap-draft.refreshed",
      payload: { caseId: job.caseId },
    });
  });
}

/** Start the worker; idempotent (safe to call multiple times). */
export function startVoiceSoapWorker(): void {
  getQueue().registerWorker<VoiceSoapJob>(QUEUE_NAME, JOB_NAME, process);
  console.info("[worker] voice-soap registered");
}

// Named export for tests — exposes the inner handler without queue plumbing.
export { process as _processForTests };
