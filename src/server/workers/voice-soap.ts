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
 *      `MedicalCase.soapDraft`. A draft already there is kept and the new
 *      dictation is added below it (audit AC-13): overwriting lost the
 *      doctor's earlier dictation or his own edits without a word.
 *   5. Audit `VOICE_SOAP_DRAFTED` on `MedicalCase`.
 *   6. Publish `case.soap-draft.refreshed` SSE event so the open case page
 *      surfaces the new draft without a refresh.
 *
 * Failures: when transcribe or structuring throws, we log + skip the
 * draft write. The Whisper / LLM proxy will have already written a
 * failure `LLMUsage` row (errorCode populated), so the dashboard sees it.
 */

import { AI_ENABLED } from "@/lib/ai-enabled";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { AUDIT_ACTION } from "@/lib/audit-actions";

import { transcribe } from "@/server/ai/transcribe";
import { structureSoap, stitchSoapMarkdown } from "@/server/ai/soap";
import {
  hydrateMedicalCaseForRead,
  serializeMedicalCaseForWrite,
} from "@/server/medical-case/cipher-fields";
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
  // AI is paused (audit UX-01): no transcription, no LLM, and above all no
  // overwrite of the case's SOAP draft with «[mock-transcript] Пациент
  // жалуется на головную боль».
  if (!AI_ENABLED) {
    console.info(`[voice-soap] AI paused, job for case ${job.caseId} dropped`);
    return;
  }
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

    // 3) Write the draft, keeping what is there (audit AC-13): a non-empty
    //    draft gets the new dictation appended. `soapDraft` is encrypted at
    //    rest; the boundary helpers decrypt the old text and encrypt the new.
    const current = await prisma.medicalCase.findUnique({
      where: { id: job.caseId },
      select: { soapDraft: true },
    });
    const previous = current
      ? hydrateMedicalCaseForRead({ soapDraft: current.soapDraft }).soapDraft
      : null;
    if (current?.soapDraft && previous === null) {
      // Stored but unreadable (a damaged envelope reads as null): writing
      // would destroy it for good, so this dictation is not saved.
      console.warn(`[voice-soap] case ${job.caseId}: draft unreadable, not overwritten`);
      return;
    }
    await prisma.medicalCase.update({
      where: { id: job.caseId },
      data: serializeMedicalCaseForWrite({
        soapDraft: appendSoapDraft(previous, markdown),
      }),
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

/**
 * The draft after a new dictation: the new text alone when there was none,
 * otherwise the old draft, a rule, and the new text. Pure; exported for tests.
 */
export function appendSoapDraft(previous: string | null, next: string): string {
  const old = (previous ?? "").trim();
  if (!old) return next;
  return `${old}\n\n---\n\n${next}`;
}

/** Start the worker; idempotent (safe to call multiple times). */
export function startVoiceSoapWorker(): void {
  getQueue().registerWorker<VoiceSoapJob>(QUEUE_NAME, JOB_NAME, process);
  console.info("[worker] voice-soap registered");
}

// Named export for tests — exposes the inner handler without queue plumbing.
export { process as _processForTests };
