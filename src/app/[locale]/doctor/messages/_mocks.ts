export type ThreadChannel = "internal" | "telegram" | "sms" | "patient";

export type Thread = {
  id: string;
  kind: "patient" | "telegram" | "sms" | "internal";
  title: string;
  preview: string;
  when: string;
  unread?: number;
  avatar?: { initials: string };
  patient?: boolean;
  selected?: boolean;
  attachment?: string;
};

export const MOCK_TABS = [
  { key: "all", label: "Все" },
  { key: "unread", label: "Непрочитанные", count: 2 },
  { key: "starred", label: "Избранные" },
] as const;

export const MOCK_CHANNEL_CHIPS = [
  { key: "all", label: "Все", selected: true },
  { key: "internal", label: "Внутренние" },
  { key: "telegram", label: "Telegram" },
  { key: "sms", label: "SMS" },
] as const;

export const MOCK_THREADS: Thread[] = [
  {
    id: "t-1",
    kind: "patient",
    title: "Юлдашев Иван Икромович",
    preview: "Доброе утро, доктор. Я хотел уточнить...",
    when: "09:14",
    unread: 2,
    avatar: { initials: "ЮИ" },
    patient: true,
    selected: true,
  },
  {
    id: "t-2",
    kind: "patient",
    title: "Мухитдинова Шахноза Сал...",
    preview: "Спасибо за консультацию, стало лучше.",
    when: "Вчера",
    avatar: { initials: "МС" },
    patient: true,
  },
  {
    id: "t-3",
    kind: "patient",
    title: "Бурхонов Абдулазиз Икромович",
    preview: "Хорошо, буду на приёме в пятницу.",
    when: "Вчера",
    avatar: { initials: "БА" },
    patient: true,
  },
  {
    id: "t-4",
    kind: "telegram",
    title: "Telegram: @shahnoza_m",
    preview: "Здравствуйте, у меня вопрос по лечению...",
    when: "12 мая",
  },
  {
    id: "t-5",
    kind: "sms",
    title: "SMS: +998 90 123-45-67",
    preview: "Напоминание: приём 15.05 в 10:30...",
    when: "12 мая",
  },
  {
    id: "t-6",
    kind: "internal",
    title: "Коллега: Д-р Ибрагимова М.",
    preview: "Обсуждение пациента Мексидон 125 мг...",
    when: "11 мая",
    avatar: { initials: "ДИ" },
  },
  {
    id: "t-7",
    kind: "telegram",
    title: "Telegram: @abdulaziz_b",
    preview: "Файл: mri_results.pdf",
    when: "10 мая",
    attachment: "mri_results.pdf",
  },
  {
    id: "t-8",
    kind: "sms",
    title: "SMS: +998 93 987-45-43",
    preview: "Спасибо, доктор!",
    when: "09 мая",
  },
];

export const MOCK_CHAT_PATIENT = {
  fullName: "Юлдашев Иван Икромович",
  age: 37,
  birthDate: "14.06.1988",
  phone: "+998 (91) 910-05-37",
  id: "#P-001247",
  initials: "ЮИ",
};

export type ChatMessage = {
  id: string;
  side: "in" | "out";
  text: string;
  time: string;
  read?: boolean;
  emoji?: string;
};

export const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: "m-1",
    side: "in",
    text: "Доброе утро, доктор. Я хотел уточнить, можно ли мне увеличить дозировку Мексидона?",
    time: "09:02",
  },
  {
    id: "m-2",
    side: "out",
    text: "Здравствуйте, Иван Икромович. Увеличивать дозировку самостоятельно не рекомендуется. Как вы сейчас себя чувствуете?",
    time: "09:04",
    read: true,
  },
  {
    id: "m-3",
    side: "in",
    text: "Чувствую себя лучше, головокружение стало реже, но иногда появляется слабость.",
    time: "09:06",
  },
  {
    id: "m-4",
    side: "out",
    text: "Понятно. Продолжайте текущую схему лечения. Если слабость будет усиливаться, запишитесь на повторный приём.",
    time: "09:07",
    read: true,
  },
  {
    id: "m-5",
    side: "in",
    text: "Хорошо, спасибо! Запишусь на приём.",
    time: "09:08",
    emoji: "👍",
  },
];

export const MOCK_SYSTEM_NOTICE = {
  title: "Напоминание о приёме",
  text: "Напоминание: Ваш повторный приём запланирован на 15.05.2025 в 10:30.",
  time: "09:10",
};

export const MOCK_COMPOSER_TABS = [
  { key: "message", label: "Сообщение" },
  { key: "templates", label: "Шаблоны" },
  { key: "reminder", label: "Напоминание" },
] as const;

export const MOCK_PATIENT_CONTEXT = {
  lastVisit: {
    date: "13 мая 2025, 09:00 – 09:30",
    meta: "Кабинет 6 • Консультация",
  },
  lastDiagnosis: {
    code: "F41.1",
    name: "Генерализованное тревожное расстройство",
    meta: "Хроническое течение, средняя степень тяжести",
  },
  treatment: [
    { name: "Мексидон 125 мг", dose: "по 1 таб. 2 раза в день" },
    { name: "Глицин 100 мг", dose: "по 1 таб. 2 раза в день" },
    { name: "Витамин B1", dose: "по 100 мг 1 раз в день" },
  ],
};

export const MOCK_AI_QUICK_REPLIES = [
  {
    id: "qr-1",
    title: "Рекомендация по лечению",
    description: "Ответ с рекомендациями по текущему лечению на основе последних данных пациента.",
  },
  {
    id: "qr-2",
    title: "Напоминание о приёме",
    description: "Отправить напоминание о предстоящем приёме и подготовке.",
  },
  {
    id: "qr-3",
    title: "Общее информирование",
    description: "Ответы на частые вопросы пациентов о состоянии и лечении.",
  },
];
