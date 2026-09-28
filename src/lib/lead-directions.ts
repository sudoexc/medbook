/**
 * What a visitor asks for on the site booking form («Направление»).
 *
 * The form used to offer nothing but a required doctor, picked among the
 * doctors the CRM serves (today one or two neurologists). A parent who
 * wanted an EEG or the pediatric neurologist either pinned the request on
 * the wrong doctor or could not send it at all, and with an empty doctor
 * list (a short DB hiccup) the form never submitted (audit LD-09).
 *
 * The directions mirror the price sheet the landing shows (services.groups):
 * the consultations and the diagnostics. The stable key is what Lead.service
 * stores, so reception reads the request in its own language (labels live
 * in `leadForm.directions.<key>`), and a request stays readable after a
 * label is reworded.
 *
 * `consultation` directions are the ones where a doctor choice means
 * something; a diagnostic (EEG, ECG, ultrasound) is booked by reception on
 * whoever runs the device, so the form does not ask for a doctor there.
 */
export type LeadDirectionKind = "consultation" | "diagnostics";

export const LEAD_DIRECTIONS = [
  { key: "neurologist", kind: "consultation" },
  { key: "childNeurologist", kind: "consultation" },
  { key: "cardiologist", kind: "consultation" },
  { key: "eeg", kind: "diagnostics" },
  { key: "eegSleep", kind: "diagnostics" },
  { key: "reoeg", kind: "diagnostics" },
  { key: "echoeg", kind: "diagnostics" },
  { key: "ecg", kind: "diagnostics" },
  { key: "echocg", kind: "diagnostics" },
  { key: "doppler", kind: "diagnostics" },
  { key: "ultrasound", kind: "diagnostics" },
] as const satisfies ReadonlyArray<{ key: string; kind: LeadDirectionKind }>;

export type LeadDirectionKey = (typeof LEAD_DIRECTIONS)[number]["key"];

const BY_KEY = new Map<string, LeadDirectionKind>(
  LEAD_DIRECTIONS.map((d) => [d.key, d.kind]),
);

/** The direction key a stored or submitted value names, or null. */
export function leadDirectionKey(
  value: string | null | undefined,
): LeadDirectionKey | null {
  const v = value?.trim();
  return v && BY_KEY.has(v) ? (v as LeadDirectionKey) : null;
}

/**
 * Whether the form should offer a doctor for this direction. No direction
 * («не знаю, подскажите») keeps the doctor choice: someone who came from a
 * doctor's card knows whom they want even if they skip the direction.
 */
export function directionTakesDoctor(value: string | null | undefined): boolean {
  const key = leadDirectionKey(value);
  return key === null || BY_KEY.get(key) === "consultation";
}
