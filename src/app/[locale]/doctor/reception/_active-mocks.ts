export const MOCK_ACTIVE_PATIENT = {
  initials: "ЮИ",
  fullName: "Юлдашев Иван Икромович",
  statusLabel: "Активный пациент",
  age: 37,
  birthDate: "14.06.1988",
  phone: "+998 (91) 910-05-37",
  visitType: "Консультация",
  visitStatus: "На приёме",
  scheduledDate: "13 мая, 09:00 – 09:30",
  room: "Кабинет 6",
  complaintsPrev: "головные боли, онемение в правой руке",
  diagnosisPrev: "ВСД, тревожное расстройство",
  prescriptionsPrev: "Мексидол, Но-шпа, вит. B1",
  allergy: "не указано",
  consultationTimer: "00:12:47",
};

export type StructuredField = {
  key: "complaints" | "anamnesis" | "exam" | "diagnosis" | "prescriptions" | "advice";
  label: string;
  icon: "complaints" | "anamnesis" | "exam" | "diagnosis" | "prescriptions" | "advice";
  chips?: string[];
  diagnosisCode?: string;
  diagnosisName?: string;
};

export const MOCK_STRUCTURED_FIELDS: StructuredField[] = [
  {
    key: "complaints",
    label: "Жалобы",
    icon: "complaints",
    chips: ["Головная боль", "Онемение в руке", "Головокружение", "Утомляемость"],
  },
  {
    key: "anamnesis",
    label: "Анамнез",
    icon: "anamnesis",
    chips: ["Стресс", "Нарушение сна", "Повышенная тревожность"],
  },
  {
    key: "exam",
    label: "Осмотр",
    icon: "exam",
    chips: ["Сознание ясное", "Черепные нервы без патологии", "Мышечная сила сохранена"],
  },
  {
    key: "diagnosis",
    label: "Диагноз",
    icon: "diagnosis",
    diagnosisCode: "F41.1",
    diagnosisName: "Генерализованное тревожное расстройство",
  },
  {
    key: "prescriptions",
    label: "Назначения",
    icon: "prescriptions",
    chips: ["Мексидол 125 мг", "Глицин 100 мг", "Витамин B1", "Магний B6"],
  },
  {
    key: "advice",
    label: "Рекомендации",
    icon: "advice",
    chips: ["Режим сна", "Ограничить кофеин", "Физическая активность", "Контроль через 2 недели"],
  },
];

export const MOCK_SESSION_TABS = [
  { key: "session", label: "Приём", active: true },
  { key: "history", label: "История визитов" },
  { key: "documents", label: "Документы" },
  { key: "labs", label: "Анализы" },
  { key: "prescriptions", label: "Назначения" },
] as const;

export const MOCK_EDITOR_TOP_ACTIONS = [
  { key: "ai-fill", label: "AI заполнить", primary: true, icon: "sparkles" },
  { key: "ai-gen", label: "Сгенерировать заключение", primary: true, icon: "file" },
  { key: "shorten", label: "Сделать короче", icon: "scissors" },
  { key: "lang", label: "RU / UZ", icon: "lang" },
  { key: "voice", label: "Голосовой ввод", icon: "mic" },
  { key: "template", label: "Из шаблона", icon: "template" },
] as const;

export const MOCK_EDITOR_BODY = `Жалобы: головные боли, преимущественно в затылочной области, чувство онемения в правой руке, головокружение, утомляемость, раздражительность.

Анамнез заболевания: считает себя больным в течение 2 месяцев, связывает ухудшение состояния с хроническим стрессом и нарушением сна.

Объективно: сознание ясное, контакт сохранён. Черепные нервы без очаговой патологии. Мышечная сила сохранена. Сухожильные рефлексы D=S.

Диагноз: F41.1 Генерализованное тревожное расстройство.

Назначения:
- Мексидол 125 мг — по 1 таб. 2 раза в день после еды, 14 дней.
- Глицин 100 мг — по 1 таб. 2 раза в день под язык, 30 дней.
- Витамин B1 — по 100 мг 1 раз в день, 30 дней.
- Магний B6 — по 1 таб. на ночь, 30 дней.

Рекомендации:
- Соблюдать режим сна и бодрствования.
- Ограничить употребление кофеина и энергетиков.
- Физическая активность умеренной интенсивности.
- Контроль через 2 недели или раньше при ухудшении состояния.`;

export const MOCK_EDITOR_META = {
  draftAt: "09:14",
  savedLabel: "Все изменения сохранены",
};

export const MOCK_HISTORY_DOCS_TABS = [
  { key: "visits", label: "Визиты", count: 5, active: true },
  { key: "documents", label: "Документы", count: 8 },
  { key: "eeg", label: "ЭЭГ/РЭГ", count: 3 },
  { key: "drafts", label: "Черновики", count: 2 },
] as const;

export const MOCK_HISTORY_DOCS = [
  { date: "22.04.2025", type: "Повторный приём", doctor: "Рахимов Б.И.", file: "PDF" },
  { date: "15.04.2025", type: "Консультация невролога", doctor: "Рахимов Б.И.", file: "PDF" },
  { date: "08.04.2025", type: "Консультация невролога", doctor: "Рахимов Б.И.", file: "PDF" },
];

export const MOCK_RECENT_FILES = [
  { name: "ЭЭГ_Юлдашев_22.04.25.pdf", meta: "22.04.2025, 1.2 МБ" },
  { name: "МРТ_головного_мозга.pdf", meta: "18.04.2025, 4.8 МБ" },
  { name: "Анализы_крови_15.04.25.pdf", meta: "15.04.2025, 0.9 МБ" },
];

export const MOCK_RECEPTION_DRAFTS = [
  { title: "Консультация от 13.05.2025", when: "Черновик • 09:14" },
  { title: "Консультация от 22.04.2025", when: "Черновик • 16:20" },
];

export type QueueRow = {
  no: number;
  name: string;
  type: string;
  time: string;
  primary: "Начать" | "Отложить";
};

export const MOCK_RECEPTION_QUEUE: QueueRow[] = [
  { no: 1, name: "Турсунова Феруза Камиловна", type: "Консультация", time: "09:30", primary: "Начать" },
  { no: 2, name: "Мухитдинова Шахноза Салахидиновна", type: "Консультация", time: "10:00", primary: "Начать" },
  { no: 3, name: "Бурхонов Абдулазиз Икромович", type: "Повторный приём", time: "10:30", primary: "Отложить" },
];

export const MOCK_QUEUE_TOTAL = 7;

export const MOCK_AI_SUMMARY =
  "37 лет, жалобы на головные боли, онемение в правой руке, головокружение, утомляемость. Стресс, нарушение сна на 2 мес. ранее. Диагноз в истории: ВСД, треожное расстройство. Назначения ранее: Мексидол, Но-шпа, вит. B1.";

export const MOCK_AI_QUESTIONS = [
  "Какой характер головной боли?",
  "Есть ли тошнота или чувствительность к свету?",
  "Бывают ли панические атаки?",
  "Какой режим сна?",
];

export type DiagnosisHintTone = "likely" | "possible";

export const MOCK_DIAGNOSIS_HINTS: {
  code: string;
  name: string;
  tone: DiagnosisHintTone;
}[] = [
  { code: "F41.1", name: "Генерализованное тревожное расстройство", tone: "likely" },
  { code: "G44.2", name: "Головная боль напряжения", tone: "possible" },
  { code: "F43.0", name: "Острая реакция на стресс", tone: "possible" },
];

export type WarningTone = "info" | "warn" | "alert";

export const MOCK_WARNINGS: { id: string; text: string; tone: WarningTone }[] = [
  { id: "w-1", text: "Не указана аллергия", tone: "warn" },
  { id: "w-2", text: "Проверьте взаимодействие: Мексидол + ...", tone: "alert" },
  { id: "w-3", text: "Нет данных о курении и алкоголе", tone: "info" },
];

export const MOCK_QUICK_ACTIONS = [
  { id: "qa-1", title: "Использовать шаблон", subtitle: "Консультация невролога", icon: "template" },
  { id: "qa-2", title: "Подтянуть данные", subtitle: "из прошлого визита", icon: "merge" },
  { id: "qa-3", title: "Добавить назначения", subtitle: "из избранного", icon: "star" },
] as const;
