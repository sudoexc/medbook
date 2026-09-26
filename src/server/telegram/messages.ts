/**
 * Server-side bot copies — ru/uz.
 *
 * Why not next-intl? The bot runs far from a request context (webhook handler
 * dispatches into the FSM, scheduler may trigger reminders); threading a
 * locale through next-intl's async config every call is more ceremony than
 * value. A plain dictionary here is traceable and unit-testable.
 *
 * Language per chat is decided in `state.ts` — the FSM stores the selected
 * lang on the Conversation row via meta. Keep keys stable: the UI (and
 * potentially the admin template editor) may surface them.
 */

export type BotLang = "ru" | "uz";

type Dict = Record<string, string | ((...args: never[]) => string)>;

const RU: Dict = {
  "start.welcome":
    "Здравствуйте! Я бот клиники Neurofax — помогу вам записаться на приём.\n\nВыберите язык / Tilni tanlang:",
  "start.langButton.ru": "Русский",
  "start.langButton.uz": "O'zbekcha",

  "lang.confirmed": "Продолжаем на русском.",

  "miniapp.prompt":
    "Нажмите кнопку ниже, чтобы выбрать услугу, врача и удобное время прямо в приложении.",
  "miniapp.openButton": "📱 Записаться в приложении",

  "service.prompt": "Выберите специализацию:",
  "service.noneAvailable":
    "К сожалению, сейчас нет доступных услуг. Позвоните в клинику.",

  "doctor.prompt": "Выберите врача:",
  "doctor.noneAvailable":
    "Нет врачей на эту специализацию. Попробуйте выбрать другую.",

  "slot.prompt": "Выберите удобное время:",
  "slot.noneAvailable":
    "На ближайшие дни слотов нет. Попробуйте позже или позвоните в клинику.",

  "name.prompt": "Укажите ваше имя для записи:",
  "name.tooShort": "Имя слишком короткое. Попробуйте ещё раз.",

  "confirm.summary": "Проверьте запись:",
  "confirm.confirmBtn": "Подтвердить",
  "confirm.cancelBtn": "Отмена",

  "done.success": "Вы записаны! Мы отправим напоминание заранее.",
  "done.cancelled": "Запись отменена.",

  "common.back": "Назад",
  "common.restart": "Начать заново",
  "common.takeover":
    "Сейчас с вами говорит оператор клиники. Бот ответит, когда оператор завершит диалог.",
  "common.error": "Что-то пошло не так, попробуйте /start",
  "common.unknownCommand":
    "Не понял запроса. Нажмите кнопку или отправьте /start, чтобы начать заново.",

  // Phase 15 Wave 5 — Voice → SOAP intake replies (doctor-only path).
  // Lives here because the bot already has its own dictionary and threading
  // next-intl through the polling worker would be ceremony.
  // Audit PH-01 / MA-04 — replies to a contact shared from the Mini App.
  "contact.verified": "Спасибо, номер подтверждён.",
  "contact.linked":
    "Спасибо, номер подтверждён. Мы нашли вашу карту в клинике: история визитов теперь в приложении.",
  "contact.conflict":
    "Номер подтверждён, но этот номер уже связан с другой картой. Регистратура проверит и свяжется с вами.",
  "contact.keptExisting":
    "В вашей карте уже указан другой номер. Если он изменился, скажите об этом в регистратуре.",
  "contact.nameMismatch":
    "Номер получен, но в клинике он записан на пациента с другим именем. Регистратура проверит и свяжется с вами.",
  "contact.pending":
    "Спасибо, номер получен. Регистратура проверит и привяжет вашу карту, после этого история визитов появится в приложении.",
  "contact.notOwn":
    "Нужен ваш собственный номер. Нажмите «Подтвердить номер через Telegram» в приложении клиники.",
  "contact.noCard":
    "Сначала откройте приложение клиники, затем подтвердите номер.",

  "tgVoiceReply.received":
    "Получил, расшифровываю и структурирую SOAP-черновик. Откройте случай в CRM через минуту.",
  "tgVoiceReply.noActiveCase":
    "Нет активного случая. Откройте случай в CRM, чтобы получить SOAP-черновик.",
  "tgVoiceReply.aiPaused":
    "Голосовые SOAP-черновики сейчас отключены. Запишите осмотр в CRM.",
};

const UZ: Dict = {
  "start.welcome":
    "Assalomu alaykum! Men Neurofax klinikasi botiman — qabulga yozilishda yordam beraman.\n\nTilni tanlang / Выберите язык:",
  "start.langButton.ru": "Русский",
  "start.langButton.uz": "O'zbekcha",

  "lang.confirmed": "Davom etamiz o'zbek tilida.",

  "miniapp.prompt":
    "Xizmat, shifokor va qulay vaqtni ilovada tanlash uchun tugmani bosing.",
  "miniapp.openButton": "📱 Ilovada yozilish",

  "service.prompt": "Yo'nalishni tanlang:",
  "service.noneAvailable":
    "Afsus, hozir bo'sh xizmat yo'q. Iltimos, klinikaga qo'ng'iroq qiling.",

  "doctor.prompt": "Shifokorni tanlang:",
  "doctor.noneAvailable":
    "Bu yo'nalish bo'yicha shifokor yo'q. Boshqa yo'nalishni tanlang.",

  "slot.prompt": "Qulay vaqtni tanlang:",
  "slot.noneAvailable":
    "Yaqin kunlarda bo'sh vaqt yo'q. Keyinroq urinib ko'ring yoki qo'ng'iroq qiling.",

  "name.prompt": "Yozilish uchun ismingizni yuboring:",
  "name.tooShort": "Ism juda qisqa. Yana urinib ko'ring.",

  "confirm.summary": "Yozuvni tekshiring:",
  "confirm.confirmBtn": "Tasdiqlash",
  "confirm.cancelBtn": "Bekor qilish",

  "done.success": "Yozildingiz! Oldindan eslatma yuboramiz.",
  "done.cancelled": "Yozuv bekor qilindi.",

  "common.back": "Ortga",
  "common.restart": "Qaytadan boshlash",
  "common.takeover":
    "Hozir siz bilan klinika operatori suhbatlashmoqda. Operator tugatgach, bot javob beradi.",
  "common.error": "Xatolik yuz berdi, /start ni yuboring",
  "common.unknownCommand":
    "Tushunmadim. Tugmani bosing yoki /start ni yuboring.",

  "contact.verified": "Rahmat, raqam tasdiqlandi.",
  "contact.linked":
    "Rahmat, raqam tasdiqlandi. Klinikadagi kartangizni topdik: tashriflar tarixi endi ilovada.",
  "contact.conflict":
    "Raqam tasdiqlandi, lekin bu raqam boshqa kartaga bog'langan. Registratura tekshirib, siz bilan bog'lanadi.",
  "contact.keptExisting":
    "Kartangizda boshqa raqam ko'rsatilgan. Agar u o'zgargan bo'lsa, registraturaga ayting.",
  "contact.nameMismatch":
    "Raqam qabul qilindi, lekin klinikada u boshqa ismli bemor nomiga yozilgan. Registratura tekshirib, siz bilan bog'lanadi.",
  "contact.pending":
    "Rahmat, raqam qabul qilindi. Registratura tekshirib, kartangizni bog'laydi, shundan so'ng tashriflar tarixi ilovada paydo bo'ladi.",
  "contact.notOwn":
    "O'z raqamingiz kerak. Klinika ilovasida «Raqamni Telegram orqali tasdiqlash» tugmasini bosing.",
  "contact.noCard":
    "Avval klinika ilovasini oching, so'ng raqamni tasdiqlang.",

  "tgVoiceReply.received":
    "Qabul qildim, ovozni matnga aylantirib SOAP-qoralama tayyorlayapman. Bir daqiqadan so'ng CRM'da hodisani oching.",
  "tgVoiceReply.noActiveCase":
    "Faol hodisa yo'q. SOAP-qoralama olish uchun CRM'da hodisani oching.",
  "tgVoiceReply.aiPaused":
    "Ovozli SOAP-qoralamalar hozircha o'chirilgan. Ko'rikni CRM'da yozing.",
};

const TABLES: Record<BotLang, Dict> = { ru: RU, uz: UZ };

/**
 * Look up a key. Unknown keys return the key verbatim — unit tests enforce
 * parity between `ru` and `uz` so production drift is visible fast.
 */
export function t(lang: BotLang | undefined, key: string): string {
  const table = TABLES[lang ?? "ru"];
  const val = table[key];
  if (typeof val === "function") return val();
  if (typeof val === "string") return val;
  // Fallback to RU, then to the key itself.
  const ru = TABLES.ru[key];
  if (typeof ru === "string") return ru;
  return key;
}

/** Test helper — introspect available keys. */
export function _keys(lang: BotLang): string[] {
  return Object.keys(TABLES[lang]);
}
