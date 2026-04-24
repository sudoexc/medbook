export const CHANNELS = [
  "WALKIN",
  "PHONE",
  "TELEGRAM",
  "WEBSITE",
  "KIOSK",
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
};

export type CabinetHit = {
  id: string;
  number: string;
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
  cabinetId: string | null;
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
  cabinetId: null,
  date: new Date(),
  time: null,
  channel: "WALKIN",
  comments: "",
};
