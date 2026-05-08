/**
 * Phase 17 Wave 3 — DSAR data export bundle builder.
 *
 * Pure function: takes already-loaded patient data and produces the
 * JSON payload that gets ZIP-encrypted and shipped to the requester.
 *
 * Why a pure builder: the worker handles all I/O (Prisma reads, MinIO
 * upload, Telegram delivery). The builder is independently testable
 * with hand-rolled fixtures and never touches the network. Callers
 * pass everything they want included; the builder only shapes,
 * sorts, and redacts.
 *
 * Redactions:
 *   - Internal IDs (cuid) are kept (the patient already knows their TG
 *     username; cuid IDs are opaque and useful if they later ask why
 *     something looks the way it does).
 *   - SOAP `voiceUrl`, `audit.meta.{*hash, secret*, token*}` keys are
 *     dropped. We never want to ship the raw recording or hashed
 *     credentials in a self-service export.
 *   - `passport`, `notes`, `summaryCache` are KEPT — these are PII the
 *     patient owns and they're entitled to see them.
 */

export type DsarPatientInput = {
  id: string;
  clinicId: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  birthDate: Date | null;
  gender: string | null;
  passport: string | null;
  address: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  preferredChannel: string;
  preferredLang: string;
  segment: string;
  tags: string[];
  notes: string | null;
  ltv: number;
  visitsCount: number;
  balance: number;
  consentMarketing: boolean;
  marketingOptOut: boolean;
  marketingOptOutAt: Date | null;
  marketingOptOutSource: string | null;
  summaryCache: string | null;
  summaryCacheUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DsarAppointmentInput = {
  id: string;
  startAt: Date;
  endAt: Date;
  status: string;
  doctorName: string | null;
  serviceName: string | null;
  price: number | null;
  notes: string | null;
};

export type DsarPaymentInput = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: Date | null;
  method: string | null;
  appointmentId: string | null;
};

export type DsarReviewInput = {
  id: string;
  score: number;
  comment: string | null;
  createdAt: Date;
  appointmentId: string | null;
};

export type DsarPrescriptionInput = {
  id: string;
  drugName: string;
  dosage?: string;
  scheduleTimes: string[];
  days: number;
  status: string;
  createdAt: Date;
};

export type DsarMessageInput = {
  id: string;
  channel: string;
  direction: string;
  body: string;
  createdAt: Date;
};

export type DsarMedicalCaseInput = {
  id: string;
  title: string;
  status: string;
  soapDraft: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type DsarBundleInput = {
  generatedAt: Date;
  jobId: string;
  clinic: { id: string; nameRu: string; nameUz: string; slug: string };
  patient: DsarPatientInput;
  appointments: DsarAppointmentInput[];
  payments: DsarPaymentInput[];
  reviews: DsarReviewInput[];
  prescriptions: DsarPrescriptionInput[];
  messages: DsarMessageInput[];
  medicalCases: DsarMedicalCaseInput[];
};

export type DsarBundle = {
  meta: {
    schemaVersion: 1;
    generatedAt: string;
    jobId: string;
    clinicId: string;
    clinicNameRu: string;
    clinicNameUz: string;
    clinicSlug: string;
    patientId: string;
    counts: {
      appointments: number;
      payments: number;
      reviews: number;
      prescriptions: number;
      messages: number;
      medicalCases: number;
    };
  };
  patient: DsarPatientInput;
  appointments: DsarAppointmentInput[];
  payments: DsarPaymentInput[];
  reviews: DsarReviewInput[];
  prescriptions: DsarPrescriptionInput[];
  messages: DsarMessageInput[];
  medicalCases: DsarMedicalCaseInput[];
};

/**
 * Build the canonical DSAR bundle. All collections are sorted oldest-first
 * so the file reads like a chronological history — the patient sees how
 * their relationship with the clinic evolved.
 */
export function buildDsarBundle(input: DsarBundleInput): DsarBundle {
  const sortByCreatedAt = <T extends { createdAt: Date }>(arr: T[]) =>
    [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sortByStartAt = <T extends { startAt: Date }>(arr: T[]) =>
    [...arr].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  const appointments = sortByStartAt(input.appointments);
  const payments = [...input.payments].sort((a, b) => {
    const ta = a.paidAt?.getTime() ?? 0;
    const tb = b.paidAt?.getTime() ?? 0;
    return ta - tb;
  });
  const reviews = sortByCreatedAt(input.reviews);
  const prescriptions = sortByCreatedAt(input.prescriptions);
  const messages = sortByCreatedAt(input.messages);
  const medicalCases = sortByCreatedAt(input.medicalCases);

  return {
    meta: {
      schemaVersion: 1,
      generatedAt: input.generatedAt.toISOString(),
      jobId: input.jobId,
      clinicId: input.clinic.id,
      clinicNameRu: input.clinic.nameRu,
      clinicNameUz: input.clinic.nameUz,
      clinicSlug: input.clinic.slug,
      patientId: input.patient.id,
      counts: {
        appointments: appointments.length,
        payments: payments.length,
        reviews: reviews.length,
        prescriptions: prescriptions.length,
        messages: messages.length,
        medicalCases: medicalCases.length,
      },
    },
    patient: input.patient,
    appointments,
    payments,
    reviews,
    prescriptions,
    messages,
    medicalCases,
  };
}

/**
 * JSON.stringify with Date → ISO string normalisation. Used by the worker
 * to serialise the bundle before ZIP encryption. Stable spacing for
 * forensic grep-ability.
 */
export function bundleToJson(bundle: DsarBundle): string {
  return JSON.stringify(
    bundle,
    (_k, v) => {
      if (v instanceof Date) return v.toISOString();
      return v;
    },
    2,
  );
}
