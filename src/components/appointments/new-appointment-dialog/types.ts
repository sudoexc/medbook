/**
 * Booking channels offered by the dialog. Two-lanes (docs/TZ-two-lanes.md):
 * this dialog creates SCHEDULE-lane rows only — WALKIN/KIOSK are excluded
 * because `channel === "WALKIN"` is the live-lane discriminator (a "booking"
 * minted with it disappears from the «Записи» sections, reserves no slot and
 * never reaches the TV). Walk-ins go through «Выдать талон» (`registerWalkin`).
 */
export const CHANNELS = [
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
] as const;

export type ChannelType = (typeof CHANNELS)[number];

export const SOURCES = [
  "WEBSITE",
  "TELEGRAM",
  "INSTAGRAM",
  "CALL",
  "WALKIN",
  "REFERRAL",
  "ADS",
  "OTHER",
] as const;

export type SourceType = (typeof SOURCES)[number];

export type PatientHit = {
  id: string;
  fullName: string;
  phone: string;
  phoneNormalized: string;
  photoUrl: string | null;
  segment: string;
};

export type ServiceHit = {
  id: string;
  nameRu: string;
  nameUz: string;
  priceBase: number;
  durationMin: number;
  category: string | null;
};

export type DoctorHit = {
  id: string;
  nameRu: string;
  nameUz: string;
  photoUrl: string | null;
  color: string | null;
  isActive: boolean;
  // Phase 11: each doctor is bound 1:1 to a cabinet. Surface it here so the
  // dialog can render the room read-only after the user picks a doctor.
  cabinetId: string;
  cabinet: {
    id: string;
    number: string;
    nameRu: string | null;
    nameUz: string | null;
  } | null;
};

export type NewPatientForm = {
  fullName: string;
  phone: string;
  gender: "MALE" | "FEMALE" | "";
  source: SourceType | "";
};

export type FormState = {
  patient: PatientHit | null;
  newPatient: boolean;
  newPatientForm: NewPatientForm;
  serviceIds: string[];
  doctorId: string | null;
  date: Date;
  time: string | null;
  channel: ChannelType;
  comments: string;
};

export const EMPTY: FormState = {
  patient: null,
  newPatient: false,
  newPatientForm: {
    fullName: "",
    phone: "",
    gender: "",
    source: "",
  },
  serviceIds: [],
  doctorId: null,
  date: new Date(),
  time: null,
  channel: "PHONE",
  comments: "",
};
