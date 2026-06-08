/**
 * Phase 19 Wave 2 — Onboarding playbook catalog.
 *
 * A self-service signup picks ONE of these (or "start blank"). The applier
 * (`src/server/onboarding/apply-playbook.ts`) materialises the bundle into
 * the freshly-created clinic: services, notification templates and a
 * sensible workday/slot schedule default.
 *
 * Catalog rationale (UZ-market):
 *   - general     — multidisciplinary clinic; broad service set.
 *   - dental      — single-specialty; high-frequency hygiene + caries flow.
 *   - neurology   — flagship NeuroFax pattern; long consultations, MRI/EEG.
 *   - pediatric   — infant + child consults, vaccinations, growth tracking.
 *   - cosmetology — aesthetic injections, lasers, post-procedure care.
 *
 * Pricing is in tiins (1 UZS = 100 tiins, like kopeks). All ranges match
 * 2026 Tashkent mid-market price points for the corresponding service.
 *
 * Templates use `TRIGGER_KEYS` from `@/server/notifications/triggers`. Each
 * playbook ships with the four templates `fireTrigger` actually emits out of
 * the box on appointment booking: confirmation + 3d / 24h / 2h reminders.
 * Stage 2.D added the 3d "gentle ping" — audience is filtered at the
 * materialiser to TELEGRAM/WEBSITE bookings whose `confirmedAt` is still
 * null, so PHONE/KIOSK/WALKIN auto-confirms never receive it. The applier
 * maps these `TriggerKey` values to the `NotificationTrigger` enum +
 * `triggerConfig.offsetMin` shape that `whereForTrigger` (in triggers.ts)
 * looks up.
 */
import type { TriggerKey } from "@/server/notifications/triggers";

export const PLAYBOOK_SLUGS = [
  "general",
  "dental",
  "neurology",
  "pediatric",
  "cosmetology",
] as const;

export type PlaybookSlug = (typeof PLAYBOOK_SLUGS)[number];

export type PlaybookService = {
  /** Human-readable code, unique within a clinic (e.g. `consult-primary`). */
  code: string;
  nameRu: string;
  nameUz: string;
  durationMin: number;
  /**
   * Price in tiins (minor unit for UZS — 1 UZS = 100 tiins). E.g.
   * 350_000 UZS → `35_000_000`.
   */
  priceTiins: number;
};

export type PlaybookTemplate = {
  trigger: TriggerKey;
  channel: "TG" | "EMAIL" | "INAPP";
  bodyRu: string;
  bodyUz: string;
};

export type PlaybookSchedule = {
  /** "HH:MM" 24h, e.g. "09:00". */
  workdayStart: string;
  workdayEnd: string;
  slotMin: number;
};

export type Playbook = {
  slug: PlaybookSlug;
  nameRu: string;
  nameUz: string;
  services: PlaybookService[];
  templates: PlaybookTemplate[];
  schedule: PlaybookSchedule;
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared notification template trio. Every playbook surfaces these three
// triggers with playbook-flavoured Russian + Uzbek copy. The placeholders
// match `@/server/notifications/template` rendering rules.
// ─────────────────────────────────────────────────────────────────────────────

const RU_CONFIRM =
  "Здравствуйте, {{patient.firstName}}! Вы записаны в {{clinic.name}} на {{appointment.date}} в {{appointment.time}} — {{appointment.doctor}}. До встречи!";
const UZ_CONFIRM =
  "Assalomu alaykum, {{patient.firstName}}! {{clinic.name}}da {{appointment.date}} kuni soat {{appointment.time}} ga yozildingiz — {{appointment.doctor}}. Ko'rishguncha!";

// Stage 2.D — softer T-3d "gentle ping". No urgency, no YES required.
// The detector's 72h horizon surfaces unconfirmed rows in the Action Center;
// this template just gives the patient an early heads-up they can call to
// reschedule on. Audience is gated at the materialiser (`confirmedAt: null`,
// i.e. TELEGRAM/WEBSITE bookings only).
const RU_3D =
  "Напоминаем: визит к {{appointment.doctor}} {{appointment.date}} в {{appointment.time}}. Если планы изменились — позвоните: {{clinic.phone}}.";
const UZ_3D =
  "Eslatma: {{appointment.doctor}} qabuluvingiz {{appointment.date}} kuni soat {{appointment.time}} da. Rejalar o'zgargan bo'lsa qo'ng'iroq qiling: {{clinic.phone}}.";

// Stage 2.D — append the "reply YES to confirm" CTA. The TG channel
// surfaces an inline "✅ Подтверждаю" button (wired in notifications-send.ts).
// The trailing sentence is a legacy artefact from the SMS-fallback era
// (SMS removed in `docs/TZ-sms-removal.md` Wave 3); we keep both RU and
// UZ trigger words ("YES / ДА / HA") because patients still type them
// into the chat thread by reflex and the TG webhook tolerates the input.
const RU_24H =
  "Напоминание: завтра в {{appointment.time}} у вас приём в {{clinic.name}} — {{appointment.doctor}}. Адрес: {{clinic.address}}. Чтобы подтвердить, ответьте YES (или ДА / HA).";
const UZ_24H =
  "Eslatma: ertaga soat {{appointment.time}} da {{clinic.name}}da qabuluvingiz bor — {{appointment.doctor}}. Manzil: {{clinic.address}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering.";

const RU_2H =
  "Через 2 часа ваш приём в {{clinic.name}} ({{appointment.doctor}}). Если не сможете — позвоните: {{clinic.phone}}. Чтобы подтвердить, ответьте YES (или ДА / HA).";
const UZ_2H =
  "2 soatdan so'ng {{clinic.name}}da qabuluvingiz bor ({{appointment.doctor}}). Kelolmasangiz qo'ng'iroq qiling: {{clinic.phone}}. Tasdiqlash uchun HA (yoki YES / ДА) deb javob bering.";

function trio(
  flavour: { confirmRu: string; confirmUz: string },
): PlaybookTemplate[] {
  return [
    {
      trigger: "appointment.created",
      channel: "TG",
      bodyRu: flavour.confirmRu,
      bodyUz: flavour.confirmUz,
    },
    {
      trigger: "appointment.reminder-3d",
      channel: "TG",
      bodyRu: RU_3D,
      bodyUz: UZ_3D,
    },
    {
      trigger: "appointment.reminder-24h",
      channel: "TG",
      bodyRu: RU_24H,
      bodyUz: UZ_24H,
    },
    {
      trigger: "appointment.reminder-2h",
      channel: "TG",
      bodyRu: RU_2H,
      bodyUz: UZ_2H,
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-playbook data
// ─────────────────────────────────────────────────────────────────────────────

const general: Playbook = {
  slug: "general",
  nameRu: "Многопрофильная клиника",
  nameUz: "Ko'p profilli klinika",
  services: [
    {
      code: "consult-therapist",
      nameRu: "Консультация терапевта",
      nameUz: "Terapevt maslahati",
      durationMin: 30,
      priceTiins: 15_000_000, // 150 000 UZS
    },
    {
      code: "consult-cardiologist",
      nameRu: "Консультация кардиолога",
      nameUz: "Kardiolog maslahati",
      durationMin: 45,
      priceTiins: 25_000_000,
    },
    {
      code: "ultrasound-abdomen",
      nameRu: "УЗИ органов брюшной полости",
      nameUz: "Qorin bo'shlig'i UZI",
      durationMin: 30,
      priceTiins: 18_000_000,
    },
    {
      code: "ecg",
      nameRu: "ЭКГ с расшифровкой",
      nameUz: "EKG va izohlash",
      durationMin: 20,
      priceTiins: 8_000_000,
    },
    {
      code: "blood-panel",
      nameRu: "Общий анализ крови",
      nameUz: "Umumiy qon tahlili",
      durationMin: 15,
      priceTiins: 9_000_000,
    },
    {
      code: "annual-checkup",
      nameRu: "Ежегодный check-up",
      nameUz: "Yillik check-up",
      durationMin: 90,
      priceTiins: 80_000_000,
    },
  ],
  templates: trio({
    confirmRu: RU_CONFIRM,
    confirmUz: UZ_CONFIRM,
  }),
  schedule: {
    workdayStart: "09:00",
    workdayEnd: "19:00",
    slotMin: 30,
  },
};

const dental: Playbook = {
  slug: "dental",
  nameRu: "Стоматология",
  nameUz: "Stomatologiya",
  services: [
    {
      code: "dental-consult",
      nameRu: "Первичная консультация стоматолога",
      nameUz: "Stomatolog birlamchi maslahati",
      durationMin: 30,
      priceTiins: 10_000_000,
    },
    {
      code: "dental-hygiene",
      nameRu: "Профессиональная гигиена + Air Flow",
      nameUz: "Professional gigiyena + Air Flow",
      durationMin: 60,
      priceTiins: 45_000_000,
    },
    {
      code: "dental-caries",
      nameRu: "Лечение кариеса (1 зуб)",
      nameUz: "Karies davolash (1 tish)",
      durationMin: 60,
      priceTiins: 60_000_000,
    },
    {
      code: "dental-canal",
      nameRu: "Лечение каналов (1 канал)",
      nameUz: "Tish kanalini davolash (1 kanal)",
      durationMin: 90,
      priceTiins: 90_000_000,
    },
    {
      code: "dental-whitening",
      nameRu: "Отбеливание Zoom-4",
      nameUz: "Zoom-4 oqartirish",
      durationMin: 90,
      priceTiins: 220_000_000,
    },
    {
      code: "dental-implant-consult",
      nameRu: "Консультация имплантолога",
      nameUz: "Implantolog maslahati",
      durationMin: 45,
      priceTiins: 20_000_000,
    },
  ],
  templates: trio({
    confirmRu:
      "Здравствуйте, {{patient.firstName}}! Запись подтверждена: {{clinic.name}}, {{appointment.date}} в {{appointment.time}} — {{appointment.doctor}}. Не забудьте поесть за час до визита.",
    confirmUz:
      "Assalomu alaykum, {{patient.firstName}}! Yozuv tasdiqlandi: {{clinic.name}}, {{appointment.date}} kuni soat {{appointment.time}} — {{appointment.doctor}}. Tashrifdan 1 soat oldin ovqatlanishni unutmang.",
  }),
  schedule: {
    workdayStart: "09:00",
    workdayEnd: "20:00",
    slotMin: 30,
  },
};

const neurology: Playbook = {
  slug: "neurology",
  nameRu: "Неврология",
  nameUz: "Nevrologiya",
  services: [
    {
      code: "neuro-primary",
      nameRu: "Первичная консультация невролога",
      nameUz: "Nevrolog birlamchi maslahati",
      durationMin: 60,
      priceTiins: 35_000_000,
    },
    {
      code: "neuro-followup",
      nameRu: "Повторная консультация невролога",
      nameUz: "Nevrolog takroriy maslahati",
      durationMin: 30,
      priceTiins: 22_000_000,
    },
    {
      code: "neuro-eeg",
      nameRu: "ЭЭГ с расшифровкой",
      nameUz: "EEG va izohlash",
      durationMin: 60,
      priceTiins: 40_000_000,
    },
    {
      code: "neuro-emg",
      nameRu: "ЭНМГ",
      nameUz: "ENMG",
      durationMin: 45,
      priceTiins: 55_000_000,
    },
    {
      code: "neuro-mri-consult",
      nameRu: "Расшифровка МРТ + рекомендации",
      nameUz: "MRT izohlash + tavsiyalar",
      durationMin: 30,
      priceTiins: 18_000_000,
    },
    {
      code: "neuro-headache-program",
      nameRu: "Программа «Головная боль»",
      nameUz: "«Bosh og'rig'i» dasturi",
      durationMin: 90,
      priceTiins: 95_000_000,
    },
  ],
  templates: trio({
    confirmRu:
      "Здравствуйте, {{patient.firstName}}! Записываем на неврологический приём: {{clinic.name}}, {{appointment.date}} в {{appointment.time}} — {{appointment.doctor}}. Возьмите с собой результаты предыдущих обследований.",
    confirmUz:
      "Assalomu alaykum, {{patient.firstName}}! Nevrologik qabulga yozildingiz: {{clinic.name}}, {{appointment.date}} kuni soat {{appointment.time}} — {{appointment.doctor}}. Avvalgi tekshiruv natijalarini olib keling.",
  }),
  schedule: {
    workdayStart: "08:00",
    workdayEnd: "18:00",
    slotMin: 30,
  },
};

const pediatric: Playbook = {
  slug: "pediatric",
  nameRu: "Педиатрия",
  nameUz: "Pediatriya",
  services: [
    {
      code: "ped-primary",
      nameRu: "Первичный осмотр педиатра",
      nameUz: "Pediatr birlamchi ko'rigi",
      durationMin: 30,
      priceTiins: 20_000_000,
    },
    {
      code: "ped-followup",
      nameRu: "Повторный осмотр педиатра",
      nameUz: "Pediatr takroriy ko'rigi",
      durationMin: 20,
      priceTiins: 12_000_000,
    },
    {
      code: "ped-vaccination",
      nameRu: "Вакцинация (без стоимости вакцины)",
      nameUz: "Emlash (vaktsina narxisiz)",
      durationMin: 20,
      priceTiins: 7_000_000,
    },
    {
      code: "ped-growth-checkup",
      nameRu: "Контроль роста и развития",
      nameUz: "O'sish va rivojlanish nazorati",
      durationMin: 45,
      priceTiins: 25_000_000,
    },
    {
      code: "ped-allergy",
      nameRu: "Консультация аллерголога",
      nameUz: "Allergolog maslahati",
      durationMin: 30,
      priceTiins: 22_000_000,
    },
    {
      code: "ped-newborn-program",
      nameRu: "Программа «Новорождённый» (1 мес.)",
      nameUz: "«Yangi tug'ilgan» dasturi (1 oy)",
      durationMin: 60,
      priceTiins: 120_000_000,
    },
  ],
  templates: trio({
    confirmRu:
      "Здравствуйте, {{patient.firstName}}! Ждём вашего малыша: {{clinic.name}}, {{appointment.date}} в {{appointment.time}} — {{appointment.doctor}}. Возьмите карту прививок, если она у вас на руках.",
    confirmUz:
      "Assalomu alaykum, {{patient.firstName}}! Farzandingizni kutamiz: {{clinic.name}}, {{appointment.date}} kuni soat {{appointment.time}} — {{appointment.doctor}}. Emlash kartasi bo'lsa, olib keling.",
  }),
  schedule: {
    workdayStart: "08:00",
    workdayEnd: "19:00",
    slotMin: 20,
  },
};

const cosmetology: Playbook = {
  slug: "cosmetology",
  nameRu: "Косметология",
  nameUz: "Kosmetologiya",
  services: [
    {
      code: "cosmo-consult",
      nameRu: "Консультация косметолога",
      nameUz: "Kosmetolog maslahati",
      durationMin: 30,
      priceTiins: 12_000_000,
    },
    {
      code: "cosmo-cleaning",
      nameRu: "Комбинированная чистка лица",
      nameUz: "Yuzni kombinatsiyalangan tozalash",
      durationMin: 90,
      priceTiins: 55_000_000,
    },
    {
      code: "cosmo-botox",
      nameRu: "Ботулинотерапия (1 зона)",
      nameUz: "Botulinoterapiya (1 zona)",
      durationMin: 30,
      priceTiins: 90_000_000,
    },
    {
      code: "cosmo-fillers",
      nameRu: "Контурная пластика филлерами (1 мл)",
      nameUz: "Filler bilan konturli plastika (1 ml)",
      durationMin: 45,
      priceTiins: 250_000_000,
    },
    {
      code: "cosmo-laser-rejuv",
      nameRu: "Лазерное омоложение",
      nameUz: "Lazer yoshartirish",
      durationMin: 60,
      priceTiins: 180_000_000,
    },
    {
      code: "cosmo-peeling",
      nameRu: "Срединный пилинг",
      nameUz: "O'rta darajali piling",
      durationMin: 60,
      priceTiins: 70_000_000,
    },
  ],
  templates: trio({
    confirmRu:
      "Здравствуйте, {{patient.firstName}}! Ждём вас: {{clinic.name}}, {{appointment.date}} в {{appointment.time}} — {{appointment.doctor}}. Просим прийти без макияжа.",
    confirmUz:
      "Assalomu alaykum, {{patient.firstName}}! Sizni kutamiz: {{clinic.name}}, {{appointment.date}} kuni soat {{appointment.time}} — {{appointment.doctor}}. Iltimos, makiyajsiz keling.",
  }),
  schedule: {
    workdayStart: "10:00",
    workdayEnd: "20:00",
    slotMin: 30,
  },
};

export const PLAYBOOKS: Record<PlaybookSlug, Playbook> = {
  general,
  dental,
  neurology,
  pediatric,
  cosmetology,
};

export function isPlaybookSlug(value: unknown): value is PlaybookSlug {
  return (
    typeof value === "string" &&
    (PLAYBOOK_SLUGS as readonly string[]).includes(value)
  );
}

/**
 * Map a high-level `TriggerKey` to the (NotificationTrigger enum value,
 * triggerConfig) pair Prisma stores. Mirrors the lookup in
 * `whereForTrigger` (src/server/notifications/triggers.ts) so seeded
 * templates match what the dispatcher looks up at runtime.
 *
 * Returns null for triggers the playbook applier shouldn't seed (no
 * canonical enum + offset mapping).
 */
export function triggerKeyToDbShape(trigger: TriggerKey): {
  trigger:
    | "MANUAL"
    | "APPOINTMENT_CREATED"
    | "APPOINTMENT_BEFORE"
    | "APPOINTMENT_MISSED"
    | "APPOINTMENT_COMPLETED"
    | "PATIENT_BIRTHDAY"
    | "PATIENT_INACTIVE_DAYS"
    | "CASE_REPEAT_DUE"
    | "CRON";
  triggerConfig: { offsetMin?: number; daysBefore?: number } | null;
  /** A stable per-trigger key for `NotificationTemplate.key` (composite-unique with clinicId). */
  key: string;
} | null {
  switch (trigger) {
    case "appointment.created":
      return { trigger: "APPOINTMENT_CREATED", triggerConfig: null, key: "reminder.confirm" };
    case "appointment.reminder-3d":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -4320 },
        key: "reminder.3d",
      };
    case "appointment.reminder-24h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -1440 },
        key: "reminder.24h",
      };
    case "appointment.reminder-5h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -300 },
        key: "reminder.5h",
      };
    case "appointment.reminder-2h":
      return {
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -120 },
        key: "reminder.2h",
      };
    case "no-show":
      return { trigger: "APPOINTMENT_MISSED", triggerConfig: { offsetMin: 30 }, key: "reminder.missed" };
    case "birthday":
      return { trigger: "PATIENT_BIRTHDAY", triggerConfig: null, key: "marketing.birthday" };
    case "case.repeat-due":
      return {
        trigger: "CASE_REPEAT_DUE",
        triggerConfig: { daysBefore: 2 },
        key: "case.repeat-due",
      };
    default:
      return null;
  }
}
