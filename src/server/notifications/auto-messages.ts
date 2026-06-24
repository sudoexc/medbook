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
 * parallel sender; the widget just toggles `isActive` and edits `bodyRu`.
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

/**
 * Default bilingual greeting for a fresh chat. Kept in sync with the FSM
 * fallback `WELCOME_TEXT` in `src/server/telegram/state.ts` — the template
 * row is the runtime source of truth once provisioned; the FSM const only
 * matters for a clinic whose `patient.welcome` row is missing/inactive.
 */
const DEFAULT_WELCOME_BODY = [
  "👋 Здравствуйте! Это клиника Neurofax.",
  "",
  "Если у вас есть вопросы — просто напишите сюда, регистратура свяжется с вами.",
  "",
  "Для записи на приём нажмите кнопку ниже.",
  "",
  "—",
  "",
  "👋 Assalomu alaykum! Bu Neurofax klinikasi.",
  "",
  "Savollar bo'lsa — shu yerga yozing, ro'yxatxona javob beradi.",
  "",
  "Qabulga yozilish uchun pastdagi tugmani bosing.",
].join("\n");

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
export function autoMessageSpecs(): AutoMessageSpec[] {
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
      bodyRu: DEFAULT_WELCOME_BODY,
      bodyUz: DEFAULT_WELCOME_BODY,
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
    const specs = autoMessageSpecs();
    const existing = await prisma.notificationTemplate.findMany({
      where: { clinicId, key: { in: specs.map((s) => s.key) } },
      select: { key: true },
    });
    const have = new Set(existing.map((r) => r.key));
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
  text: string;
  /** Placeholders the editor may use for this message (empty for welcome). */
  variables: string[];
};

/**
 * Read the three rows in widget order. Auto-provisions missing rows first so
 * the caller always gets exactly three entries.
 */
export async function getAutoMessages(
  clinicId: string,
): Promise<AutoMessageView[]> {
  await ensureAutoMessageTemplates(clinicId);
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const specs = autoMessageSpecs();
    const rows = await prisma.notificationTemplate.findMany({
      where: { clinicId, key: { in: specs.map((s) => s.key) } },
      select: { key: true, isActive: true, bodyRu: true },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return specs.map((s) => {
      const row = byKey.get(s.key);
      return {
        kind: s.kind,
        key: s.key,
        enabled: row?.isActive ?? true,
        text: row?.bodyRu ?? s.bodyRu,
        variables: allowedKeysForKind(s.kind),
      };
    });
  });
}

export type WelcomeConfig = { enabled: boolean; text: string };

/**
 * Read the clinic's welcome config for the bot FSM on first contact.
 *
 *   - `null`               — no row yet (clinic predates the widget) → caller
 *                            falls back to the hard-coded FSM greeting.
 *   - `{ enabled: false }` — admin toggled welcome OFF → bot stays silent.
 *   - `{ enabled: true }`  — send `text` as the greeting.
 *
 * Does NOT auto-provision — the webhook hot path stays read-only.
 */
export async function readWelcomeConfig(
  clinicId: string,
): Promise<WelcomeConfig | null> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const row = await prisma.notificationTemplate.findUnique({
      where: {
        clinicId_key: { clinicId, key: AUTO_MESSAGE_KEYS.welcome },
      },
      select: { isActive: true, bodyRu: true },
    });
    if (!row) return null;
    return { enabled: row.isActive, text: row.bodyRu };
  });
}
