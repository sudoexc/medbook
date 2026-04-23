/**
 * Typed handles returned from the idempotent e2e seed (`tests/e2e/seed.ts`).
 *
 * Specs should import these types — NOT the seed module itself, since the
 * seed runs as a standalone tsx script against Postgres. In tests we re-read
 * the same deterministic rows via the REST API or Prisma, then coerce them
 * into these shapes for ergonomic assertions.
 */

export type ClinicSlug = "neurofax" | "demo-clinic";

export interface SeededUser {
  email: string;
  password: string;
  role:
    | "SUPER_ADMIN"
    | "ADMIN"
    | "DOCTOR"
    | "RECEPTIONIST"
    | "NURSE"
    | "CALL_OPERATOR";
}

export interface SeededClinic {
  slug: ClinicSlug;
  nameRu: string;
  nameUz: string;
  admin: SeededUser;
  receptionist: SeededUser;
  doctors: SeededUser[];
}

/**
 * Deterministic credentials that `tests/e2e/seed.ts` always creates.
 *
 * Keep this file in lock-step with `seed.ts` — the password hashes there
 * correspond to the plaintext strings below. If you change one, change both.
 */
export const SUPER_ADMIN: SeededUser = {
  email: "super@neurofax.uz",
  password: "super",
  role: "SUPER_ADMIN",
};

export const NEUROFAX: SeededClinic = {
  slug: "neurofax",
  nameRu: "Диагностический центр NeuroFax",
  nameUz: "NeuroFax diagnostika markazi",
  admin: { email: "admin@neurofax.uz", password: "admin", role: "ADMIN" },
  receptionist: {
    email: "recept@neurofax.uz",
    password: "recept",
    role: "RECEPTIONIST",
  },
  doctors: [
    {
      email: "neurologist@neurofax.uz",
      password: "doctor",
      role: "DOCTOR",
    },
    {
      email: "cardiologist@neurofax.uz",
      password: "doctor",
      role: "DOCTOR",
    },
    {
      email: "pediatrician@neurofax.uz",
      password: "doctor",
      role: "DOCTOR",
    },
  ],
};

export const DEMO_CLINIC: SeededClinic = {
  slug: "demo-clinic",
  nameRu: "Демо-клиника",
  nameUz: "Demo klinika",
  admin: {
    email: "admin@demo-clinic.uz",
    password: "admin",
    role: "ADMIN",
  },
  receptionist: {
    email: "recept@demo-clinic.uz",
    password: "recept",
    role: "RECEPTIONIST",
  },
  doctors: [
    {
      email: "neurologist@demo-clinic.uz",
      password: "doctor",
      role: "DOCTOR",
    },
    {
      email: "cardiologist@demo-clinic.uz",
      password: "doctor",
      role: "DOCTOR",
    },
    {
      email: "pediatrician@demo-clinic.uz",
      password: "doctor",
      role: "DOCTOR",
    },
  ],
};

export const CLINICS: Record<ClinicSlug, SeededClinic> = {
  neurofax: NEUROFAX,
  "demo-clinic": DEMO_CLINIC,
};

/**
 * Deterministic patient phone suffixes the seed uses to avoid collisions
 * across clinics. Keep in sync with `tests/e2e/seed.ts`.
 */
export const PATIENT_PHONES = {
  neurofax: [
    "+998901000010",
    "+998901000020",
    "+998901000030",
    "+998901000040",
    "+998901000050",
  ],
  "demo-clinic": [
    "+998901000019",
    "+998901000029",
    "+998901000039",
    "+998901000049",
    "+998901000059",
  ],
} as const;

export const SERVICE_CODES = [
  "CONSULT",
  "EEG",
  "ECG",
  "UZI",
  "ECHO_KG",
  "MRI_HEAD",
  "CT_CHEST",
  "BLOOD_CBC",
  "RTG_KNEE",
  "MASSAGE",
] as const;

export const TEMPLATE_KEYS = [
  "reminder.24h",
  "reminder.2h",
  "reminder.confirm",
  "reminder.missed",
  "reminder.feedback",
  "marketing.birthday",
  "marketing.dormant",
  "marketing.promo",
  "transactional.payment",
  "transactional.document",
] as const;
