/**
 * Phase 3b — Reception warnings derivation.
 *
 * Pure server-side rules (no LLM). Inspects the current VisitNote draft +
 * patient context and returns a list of warnings. Roadmap §3b specifies:
 *
 *   - missing allergy record
 *   - drug interaction lookup against Prescription history
 *   - missing vitals
 *
 * The drug-interaction check is intentionally narrow: we flag when the
 * doctor prescribes a substance that appears verbatim in the patient's
 * recorded allergies. A real DDI engine (e.g. RxNorm + interaction
 * tables) is out of scope for v1; this catches the most dangerous case
 * (penicillin allergy + prescribing penicillin) cheaply.
 */

export type ReceptionWarningTone = "info" | "warn" | "alert";

export type ReceptionWarning = {
  id: string;
  text: string;
  tone: ReceptionWarningTone;
};

export type WarningsInput = {
  prescriptions: string[];
  examination: string[];
  allergies: Array<{ substance: string; severity: string }>;
  /** `true` if patient has at least one allergy record, even "NKA" (no known allergies). */
  hasAllergyRecord: boolean;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deriveReceptionWarnings(input: WarningsInput): ReceptionWarning[] {
  const out: ReceptionWarning[] = [];

  if (!input.hasAllergyRecord) {
    out.push({
      id: "missing-allergy",
      text: "Не указана аллергия — спросите пациента.",
      tone: "warn",
    });
  }

  // Drug ↔ allergy collision. Case-insensitive substring match per allergy.
  for (const allergy of input.allergies) {
    const sub = allergy.substance.trim();
    if (sub.length < 3) continue;
    const re = new RegExp(`\\b${escapeRegex(sub)}\\b`, "i");
    const hit = input.prescriptions.find((p) => re.test(p));
    if (hit) {
      const isSevere = allergy.severity.toUpperCase() === "SEVERE";
      out.push({
        id: `interaction-${sub.toLowerCase()}`,
        text: `Назначение "${hit}" содержит аллерген "${sub}" (${allergy.severity}).`,
        tone: isSevere ? "alert" : "warn",
      });
    }
  }

  // Missing vitals — looks for any blood-pressure / pulse / temperature
  // mention in the examination chips. If none, info-level nudge.
  const hasVitals = input.examination.some((e) =>
    /(АД|давлен|пульс|температ|ЧСС|BP|HR)/i.test(e),
  );
  if (input.examination.length > 0 && !hasVitals) {
    out.push({
      id: "missing-vitals",
      text: "В осмотре не указаны витальные показатели (АД, пульс, температура).",
      tone: "info",
    });
  }

  return out;
}
