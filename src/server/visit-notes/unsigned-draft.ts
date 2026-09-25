/**
 * Audit DC-01: a visit closed around an unsigned conclusion.
 *
 * My Day's «Завершить приём» (and the «switch to the next patient» flow)
 * completed the visit through the generic status PATCH, which never touches
 * the note. The conclusion stayed a draft: no document number, no
 * PatientDiagnosis, no handout or PDF for the patient, no medication
 * reminders, and the reception screen (today's IN_PROGRESS visit only) could
 * no longer open it to sign. Signing lives in /visit-notes/[id]/finalize,
 * which also completes the visit, so the status routes refuse to complete a
 * doctor's visit that carries a draft with content and name the note, and
 * the client offers to sign it instead.
 */
import { prisma } from "@/lib/prisma";
import {
  draftHasContent,
  emptyConclusionSections,
  type ConclusionSection,
} from "@/lib/visit-note-sections";

export type UnsignedDraft = {
  visitNoteId: string;
  emptySections: ConclusionSection[];
};

/** The visit's draft conclusion when it has something to sign, else null. */
export async function findUnsignedDraft(
  appointmentId: string,
): Promise<UnsignedDraft | null> {
  const draft = await prisma.visitNote.findFirst({
    where: { appointmentId, status: "DRAFT" },
    select: {
      id: true,
      diagnosisCode: true,
      diagnosisName: true,
      bodyMarkdown: true,
      prescriptions: true,
      complaints: true,
      anamnesis: true,
      examination: true,
      advice: true,
      _count: { select: { visitPrescriptions: true } },
    },
  });
  if (!draft) return null;
  const sections = {
    ...draft,
    structuredRx: draft._count?.visitPrescriptions ?? 0,
  };
  if (!draftHasContent(sections)) return null;
  return {
    visitNoteId: draft.id,
    emptySections: emptyConclusionSections(sections),
  };
}
