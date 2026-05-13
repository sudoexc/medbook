export const MOCK_PATIENT_SUMMARY = {
  initials: "ЮИ",
  fullName: "Юлдашев Иван Икромович",
  statusLabel: "Активный пациент",
  age: 37,
  birthDate: "14.06.1988",
  phone: "+998 (91) 910-05-37",
  lastVisit: "13 мая 2025, 09:00",
  lastVisitType: "Консультация",
  lastDiagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
};

export type Template = {
  id: string;
  label: string;
  starred?: boolean;
  selected?: boolean;
};

export const MOCK_TEMPLATES_FREQUENT: Template[] = [
  { id: "t1", label: "Неврологическое заключение", starred: true, selected: true },
  { id: "t2", label: "Повторный приём невролога", starred: true },
  { id: "t3", label: "Головная боль / мигрень" },
  { id: "t4", label: "Тревожные расстройства" },
  { id: "t5", label: "Соматоформные расстройства" },
];

export const MOCK_TEMPLATES_ALL: Template[] = [
  { id: "a1", label: "Эпилепсия" },
  { id: "a2", label: "Периферическая нейропатия" },
  { id: "a3", label: "Демиелинизирующие заболевания" },
  { id: "a4", label: "Когнитивные нарушения" },
  { id: "a5", label: "Нарушения сна" },
];

export type Draft = {
  id: string;
  title: string;
  when: string;
};

export const MOCK_DRAFTS: Draft[] = [
  { id: "d1", title: "Заключение от 13.05.2025", when: "13.05.2025, 09:05" },
  { id: "d2", title: "Черновик консультации", when: "12.05.2025, 16:40" },
  { id: "d3", title: "Повторный приём", when: "10.05.2025, 11:15" },
];

export type EditorSection = {
  key: string;
  label: string;
  icon:
    | "complaints"
    | "anamnesis"
    | "exam"
    | "diagnosis"
    | "rx"
    | "advice";
  body: string | string[];
  list?: boolean;
};

export const MOCK_EDITOR_SECTIONS: EditorSection[] = [
  {
    key: "complaints",
    label: "Жалобы",
    icon: "complaints",
    body: "Головные боли, чувство напряжения, тревожность, нарушения сна.",
  },
  {
    key: "anamnesis",
    label: "Анамнез",
    icon: "anamnesis",
    body: "Стресс на работе, ухудшение сна в последние 2 месяца. Ранее эпизоды панических атак.",
  },
  {
    key: "exam",
    label: "Осмотр",
    icon: "exam",
    body: "Сознание ясное. Черепные нервы без патологии. Мышечная сила сохранена. Координация не нарушена.",
  },
  {
    key: "rx",
    label: "Назначения",
    icon: "rx",
    list: true,
    body: [
      "Мексидол 125 мг — по 1 таб. 2 раза в день после еды, 14 дней.",
      "Глицин 100 мг — по 1 таб. 2 раза в день под язык, 30 дней.",
      "Витамин В1 — по 100 мг 1 раз в день, 30 дней.",
      "Магний В6 — по 1 таб. на ночь, 30 дней.",
    ],
  },
  {
    key: "advice",
    label: "Рекомендации",
    icon: "advice",
    list: true,
    body: [
      "Соблюдать режим сна и бодрствования.",
      "Ограничить употребление кофеина и энергетиков.",
      "Физическая активность умеренной интенсивности.",
      "Контроль через 2 недели или раньше при ухудшении состояния.",
    ],
  },
];

export const MOCK_DIAGNOSIS_PRIMARY = {
  code: "F41.1",
  name: "Генерализованное тревожное расстройство",
};

export const MOCK_DIAGNOSIS_SECONDARY = [
  { code: "G47.0", name: "Нарушения засыпания и поддержания сна" },
];

export type CodingTone = "primary" | "secondary" | "possible";
export type CodingSuggestion = {
  code: string;
  name: string;
  tone: CodingTone;
};

export const MOCK_CODING: CodingSuggestion[] = [
  { code: "F41.1", name: "Генерализованное тревожное расстройство", tone: "primary" },
  { code: "G47.0", name: "Нарушения засыпания и поддержания сна", tone: "secondary" },
  { code: "Z73.3", name: "Стресс, не классифицированный в др. рубриках", tone: "possible" },
];
export const MOCK_CODING_TOTAL = 5;

export const MOCK_MISSING_DATA = [
  "Уточните длительность симптомов",
  "Не указана выраженность тревожности (шкала)",
  "Нет данных о предшествующем лечении",
];

export type SmartReco = {
  id: string;
  title: string;
  description: string;
};

export const MOCK_SMART_RECOS: SmartReco[] = [
  {
    id: "1",
    title: "Добавьте шкалу GAD-7",
    description: "Для оценки уровня тревожности",
  },
  {
    id: "2",
    title: "Рассмотрите психотерапию",
    description: "КПТ показана при ГТР",
  },
  {
    id: "3",
    title: "План наблюдения",
    description: "Рекомендуется контроль через 2 недели",
  },
];
