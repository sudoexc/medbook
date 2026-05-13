export type DocTab = {
  key: string;
  label: string;
  count: number;
};

export const MOCK_DOC_TABS: DocTab[] = [
  { key: "all", label: "Все документы", count: 1248 },
  { key: "mri", label: "МРТ", count: 342 },
  { key: "ct", label: "КТ", count: 215 },
  { key: "labs", label: "Анализы", count: 418 },
  { key: "eeg", label: "ЭЭГ", count: 96 },
  { key: "enmg", label: "ЭНМГ", count: 55 },
  { key: "us", label: "УЗИ", count: 74 },
  { key: "xray", label: "Рентген", count: 32 },
];

export type RecentDoc = {
  id: string;
  filename: string;
  patient: string;
  when: string;
  kind: "pdf";
};

export const MOCK_RECENT_DOCS: RecentDoc[] = [
  {
    id: "1",
    filename: "МРТ_головного_мозга.pdf",
    patient: "Икромович И.И.",
    when: "Сегодня, 09:10",
    kind: "pdf",
  },
  {
    id: "2",
    filename: "ЭЭГ_заключение.pdf",
    patient: "Феруза К.",
    when: "Вчера, 16:45",
    kind: "pdf",
  },
  {
    id: "3",
    filename: "Анализ_крови_общий.pdf",
    patient: "Салахидинова М.Ш.",
    when: "Вчера, 11:22",
    kind: "pdf",
  },
];

export type DraftDoc = {
  id: string;
  filename: string;
  when: string;
};

export const MOCK_DRAFTS: DraftDoc[] = [
  {
    id: "1",
    filename: "Заключение_Икромович И.И.",
    when: "Изменён сегодня, 09:05",
  },
  {
    id: "2",
    filename: "Консультация_Салахидинова М.Ш.",
    when: "Изменён 12.05.2025",
  },
  {
    id: "3",
    filename: "Протокол_ЭЭГ_Феруза К.",
    when: "Изменён 11.05.2025",
  },
];

export const MOCK_STORAGE = {
  usedGb: 128.4,
  totalGb: 250,
  percent: 51,
  breakdown: [
    { key: "images", label: "Изображения", value: "78.1 ГБ", tone: "primary" as const },
    { key: "documents", label: "Документы", value: "34.6 ГБ", tone: "success" as const },
    { key: "labs", label: "Анализы", value: "15.7 ГБ", tone: "warning" as const },
  ],
};

export type DocRowStatus = "ready" | "signed" | "in_progress";

export type DocRow = {
  id: string;
  filename: string;
  patient: { name: string; age: number };
  type: string;
  date: string;
  time: string;
  size: string;
  tags: string[];
  status: DocRowStatus;
  selected?: boolean;
};

export const MOCK_DOC_ROWS: DocRow[] = [
  {
    id: "1",
    filename: "МРТ_головного_мозга.pdf",
    patient: { name: "Юлдашев И.И.", age: 37 },
    type: "МРТ",
    date: "13.05.2025",
    time: "09:10",
    size: "12.4 МБ",
    tags: ["МРТ", "Головной мозг"],
    status: "ready",
    selected: true,
  },
  {
    id: "2",
    filename: "ЭЭГ_заключение.pdf",
    patient: { name: "Феруза К.", age: 29 },
    type: "ЭЭГ",
    date: "12.05.2025",
    time: "16:45",
    size: "4.8 МБ",
    tags: ["ЭЭГ", "Эпилепсия"],
    status: "ready",
  },
  {
    id: "3",
    filename: "Анализ_крови_общий.pdf",
    patient: { name: "Салахидинова М.Ш.", age: 42 },
    type: "Анализы",
    date: "12.05.2025",
    time: "11:22",
    size: "1.2 МБ",
    tags: ["Кровь", "ОАК"],
    status: "ready",
  },
  {
    id: "4",
    filename: "КТ_пазух_носа.pdf",
    patient: { name: "Абдулазиз Б.", age: 51 },
    type: "КТ",
    date: "11.05.2025",
    time: "14:30",
    size: "18.7 МБ",
    tags: ["КТ", "Пазухи"],
    status: "ready",
  },
  {
    id: "5",
    filename: "Неврологическое_заключение.pdf",
    patient: { name: "Мухтадинова Ш.", age: 33 },
    type: "Заключение",
    date: "11.05.2025",
    time: "10:15",
    size: "0.9 МБ",
    tags: ["Консультация"],
    status: "signed",
  },
  {
    id: "6",
    filename: "УЗИ_сонных_артерий.pdf",
    patient: { name: "Бурхонов А.И.", age: 45 },
    type: "УЗИ",
    date: "10.05.2025",
    time: "12:05",
    size: "6.3 МБ",
    tags: ["УЗИ", "Сосуды"],
    status: "ready",
  },
  {
    id: "7",
    filename: "Рентген_грудной_клетки.pdf",
    patient: { name: "Хасанова Д.", age: 38 },
    type: "Рентген",
    date: "10.05.2025",
    time: "09:40",
    size: "3.6 МБ",
    tags: ["Рентген", "Лёгкие"],
    status: "ready",
  },
  {
    id: "8",
    filename: "ЭНМГ_верхние_конечности.pdf",
    patient: { name: "Каримов Т.", age: 27 },
    type: "ЭНМГ",
    date: "09.05.2025",
    time: "16:20",
    size: "5.1 МБ",
    tags: ["ЭНМГ", "Верх. конечности"],
    status: "in_progress",
  },
];

export const MOCK_DOC_PAGINATION = {
  rangeFrom: 1,
  rangeTo: 20,
  total: 1248,
  currentPage: 1,
  totalPages: 63,
  pageSize: 20,
};

export const MOCK_PREVIEW = {
  filename: "МРТ_головного_мозга.pdf",
  patient: {
    fullName: "Юлдашев Иван Икромович",
    age: 37,
    birthDate: "14.06.1988",
    id: "00012345",
  },
  studyDate: "13.05.2025 08:55",
  studyType: "МРТ · Головной мозг с контрастированием",
  tags: ["МРТ", "Головной мозг", "Контраст"],
  page: { current: 5, total: 24 },
};

export const MOCK_AI_KEY_FINDINGS = [
  "Структуры головного мозга без очаговой патологии",
  "Желудочковая система не расширена",
  "Срединные структуры не смещены",
  "Патологического накопления контраста не выявлено",
];

export const MOCK_AI_SUMMARY =
  "МР-картина без очаговых изменений. Признаков объёмных образований, свежих ишемических изменений и патологического накопления контраста не выявлено.";
