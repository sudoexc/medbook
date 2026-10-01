/**
 * Auto-messages — the three clinic-configurable Telegram automations surfaced
 * in the CRM «Авто-сообщения» widget:
 *
 *   welcome   — patient.welcome          (first contact, sent by the bot FSM)
 *   reminder  — appointment.reminder-24h (24h before, sent by the scheduler)
 *   thankYou  — appointment.thank-you    (after COMPLETED, sent on the trigger)
 *
 * Each maps 1:1 onto a NotificationTemplate row — the existing materialise →
 * NotificationSend → send-worker pipeline does the delivery. There is NO
 * parallel sender; the widget toggles `isActive` and edits `bodyRu` AND
 * `bodyUz` (audit ST-08: it used to write the Russian text only, so a new
 * address in the reminder never reached patients who read Uzbek).
 *
 * `reminder` reuses the canonical seed row from `default-templates.ts`; the
 * other two are defined here and auto-provisioned on first read (see
 * `ensureAutoMessageTemplates`) so the widget works on a clinic that predates
 * this feature without a migration or a manual seed step.
 */
import type {
  NotificationTrigger,
  TemplateCategory,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { DEFAULT_APPOINTMENT_TEMPLATES } from "./default-templates";
import { ALLOWED_KEYS_BY_TRIGGER } from "./template";

export type AutoMessageKind = "welcome" | "reminder" | "thankYou";

export const AUTO_MESSAGE_KEYS: Record<AutoMessageKind, string> = {
  welcome: "patient.welcome",
  reminder: "appointment.reminder-24h",
  thankYou: "appointment.thank-you",
};

/** The clinic names a default greeting is built from. */
export type ClinicNames = { nameRu: string; nameUz: string };

/**
 * Default greeting for a fresh chat, one per language: the bot answers in
 * the sender's language (`readWelcomeConfig`). Built from the clinic's own
 * name; every clinic used to greet patients as «клиника Neurofax» (audit
 * ST-08). The template row is the runtime source of truth once provisioned.
 */
export function defaultWelcomeBodies(clinic: ClinicNames): {
  ru: string;
  uz: string;
} {
  const nameRu = clinic.nameRu.trim();
  const nameUz = (clinic.nameUz || clinic.nameRu).trim();
  return {
    ru: [
      nameRu ? `👋 Здравствуйте! Это ${nameRu}.` : "👋 Здравствуйте!",
      "",
      "Если у вас есть вопросы, просто напишите сюда, регистратура свяжется с вами.",
      "",
      "Для записи на приём нажмите кнопку ниже.",
    ].join("\n"),
    uz: [
      nameUz ? `👋 Assalomu alaykum! Bu ${nameUz}.` : "👋 Assalomu alaykum!",
      "",
      "Savollaringiz bo'lsa, shu yerga yozing, ro'yxatxona siz bilan bog'lanadi.",
      "",
      "Qabulga yozilish uchun pastdagi tugmani bosing.",
    ].join("\n"),
  };
}

type AutoMessageSpec = {
  kind: AutoMessageKind;
  key: string;
  nameRu: string;
  nameUz: string;
  channel: "TG";
  category: TemplateCategory;
  trigger: NotificationTrigger;
  triggerConfig: Record<string, unknown> | null;
  bodyRu: string;
  bodyUz: string;
  variables: string[];
};

function reminderSpec(): AutoMessageSpec {
  const seed = DEFAULT_APPOINTMENT_TEMPLATES.find(
    (t) => t.key === AUTO_MESSAGE_KEYS.reminder,
  );
  if (!seed) {
    throw new Error(
      `[auto-messages] missing seed for ${AUTO_MESSAGE_KEYS.reminder}`,
    );
  }
  return {
    kind: "reminder",
    key: seed.key,
    nameRu: seed.nameRu,
    nameUz: seed.nameUz,
    channel: "TG",
    category: seed.category,
    trigger: seed.trigger,
    triggerConfig: seed.triggerConfig,
    bodyRu: seed.bodyRu,
    bodyUz: seed.bodyUz,
    variables: seed.variables,
  };
}

/** The three specs in widget display order. */
export function autoMessageSpecs(clinic: ClinicNames): AutoMessageSpec[] {
  const welcome = defaultWelcomeBodies(clinic);
  return [
    {
      kind: "welcome",
      key: AUTO_MESSAGE_KEYS.welcome,
      nameRu: "Приветственное сообщение",
      nameUz: "Salomlashuv xabari",
      channel: "TG",
      category: "TRANSACTIONAL",
      // No materialiser — read directly by the bot FSM on first contact.
      trigger: "MANUAL",
      triggerConfig: null,
      bodyRu: welcome.ru,
      bodyUz: welcome.uz,
      variables: [],
    },
    reminderSpec(),
    {
      kind: "thankYou",
      key: AUTO_MESSAGE_KEYS.thankYou,
      nameRu: "Спасибо за визит",
      nameUz: "Tashrif uchun rahmat",
      channel: "TG",
      category: "TRANSACTIONAL",
      trigger: "APPOINTMENT_COMPLETED",
      triggerConfig: null,
      bodyRu:
        "{{patient.firstName}}, спасибо, что были у нас сегодня! Если появятся вопросы по приёму — напишите сюда, мы на связи. Будьте здоровы 💙",
      bodyUz:
        "{{patient.firstName}}, bugun bizda bo'lganingiz uchun rahmat! Qabul bo'yicha savollar bo'lsa — shu yerga yozing, biz aloqadamiz. Sog' bo'ling 💙",
      variables: [
        "patient.firstName",
        "appointment.date",
        "appointment.doctor",
        "clinic.name",
        "clinic.phone",
      ],
    },
  ];
}

/**
 * Idempotently create any of the three rows that don't exist yet for the
 * clinic. Never clobbers existing rows (so admin edits + the canonical
 * reminder seed survive). Safe to call on every widget read.
 */
export async function ensureAutoMessageTemplates(
  clinicId: string,
): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const keys = Object.values(AUTO_MESSAGE_KEYS);
    const existing = await prisma.notificationTemplate.findMany({
      where: { clinicId, key: { in: keys } },
      select: { key: true },
    });
    const have = new Set(existing.map((r) => r.key));
    if (keys.every((k) => have.has(k))) return;
    const specs = autoMessageSpecs(await loadClinicNames(clinicId));
    const missing = specs.filter((s) => !have.has(s.key));
    if (missing.length === 0) return;
    await prisma.notificationTemplate.createMany({
      data: missing.map((s) => ({
        clinicId,
        key: s.key,
        nameRu: s.nameRu,
        nameUz: s.nameUz,
        channel: s.channel,
        category: s.category,
        trigger: s.trigger,
        triggerConfig: (s.triggerConfig ?? undefined) as never,
        bodyRu: s.bodyRu,
        bodyUz: s.bodyUz,
        variables: s.variables,
        isActive: true,
      })) as never,
      skipDuplicates: true,
    });
  });
}

/**
 * Placeholder whitelist for a widget message's editable body.
 *
 *   - `welcome` returns `[]` — the bot FSM sends this text VERBATIM on first
 *     contact (it never runs through the template renderer), so a `{{…}}`
 *     would leak as literal text. Reject any placeholder.
 *   - `reminder` / `thankYou` map to their canonical `ALLOWED_KEYS_BY_TRIGGER`
 *     entry; these go through `render()` in the materialiser.
 */
export function allowedKeysForKind(kind: AutoMessageKind): string[] {
  if (kind === "welcome") return [];
  return ALLOWED_KEYS_BY_TRIGGER[AUTO_MESSAGE_KEYS[kind]] ?? [];
}

export type AutoMessageView = {
  kind: AutoMessageKind;
  key: string;
  enabled: boolean;
  /** Russian text (`bodyRu`). */
  text: string;
  /** Uzbek text (`bodyUz`), sent to patients who read Uzbek. */
  textUz: string;
  /** Placeholders the editor may use for this message (empty for welcome). */
  variables: string[];
};

async function loadClinicNames(clinicId: string): Promise<ClinicNames> {
  const clinic = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { nameRu: true, nameUz: true },
    }),
  );
  return { nameRu: clinic?.nameRu ?? "", nameUz: clinic?.nameUz ?? "" };
}

/**
 * Read the three rows in widget order. Auto-provisions missing rows first so
 * the caller always gets exactly three entries.
 */
export async function getAutoMessages(
  clinicId: string,
): Promise<AutoMessageView[]> {
  await ensureAutoMessageTemplates(clinicId);
  const names = await loadClinicNames(clinicId);
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const specs = autoMessageSpecs(names);
    const rows = await prisma.notificationTemplate.findMany({
      where: { clinicId, key: { in: specs.map((s) => s.key) } },
      select: { key: true, isActive: true, bodyRu: true, bodyUz: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return specs.map((s) => {
      const row = byKey.get(s.key);
      return {
        kind: s.kind,
        key: s.key,
        enabled: row?.isActive ?? true,
        text: row?.bodyRu ?? s.bodyRu,
        textUz: row?.bodyUz || row?.bodyRu || s.bodyUz,
        variables: allowedKeysForKind(s.kind),
      };
    });
  });
}

export type WelcomeConfig = { enabled: boolean; text: string };

/**
 * Read the clinic's welcome for the bot FSM on first contact, in the
 * sender's language (audit ST-08: the Uzbek text was editable but never
 * sent).
 *
 *   - no row yet (clinic predates the widget) → the default greeting with
 *     the clinic's name (never a hard-coded clinic);
 *   - `{ enabled: false }` — admin toggled welcome OFF → bot stays silent;
 *   - `{ enabled: true }`  — send `text` as the greeting. It goes out
 *     verbatim: the editors refuse `{{…}}` in it (`allowedKeysForTemplate`).
 *
 * Does NOT auto-provision — the webhook hot path stays read-only.
 */
export async function readWelcomeConfig(
  clinicId: string,
  lang: "ru" | "uz" = "ru",
): Promise<WelcomeConfig | null> {
  const row = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findUnique({
      where: {
        clinicId_key: { clinicId, key: AUTO_MESSAGE_KEYS.welcome },
      },
      select: { isActive: true, bodyRu: true, bodyUz: true },
    }),
  );
  if (!row) {
    const fallback = defaultWelcomeBodies(await loadClinicNames(clinicId));
    return { enabled: true, text: lang === "uz" ? fallback.uz : fallback.ru };
  }
  const text = lang === "uz" ? row.bodyUz || row.bodyRu : row.bodyRu;
  return { enabled: row.isActive, text };
}
