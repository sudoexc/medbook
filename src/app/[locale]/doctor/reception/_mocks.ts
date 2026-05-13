/**
 * Mocks for the doctor "Приём" page — single patient view with visit history.
 */

export type PatientHeader = {
  id: string;
  fullName: string;
  initials: string;
  status: "active" | "archived";
  age: number;
  birthDate: string;
  phone: string;
  appointmentType: string;
  visitStatus: { tone: "success" | "warning" | "muted"; label: string };
  lastVisitShort: string;
  cardNumber: string;
};

export type MetaChip = {
  id: string;
  icon: "allergy" | "chronic" | "medication";
  label: string;
  value: string;
  tone: "muted" | "warning" | "destructive";
};

export type TimelinePoint = {
  id: string;
  date: string;
  type: string;
  doctorShort: string;
  current?: boolean;
};

export type VisitType = "consultation" | "repeat";

export type Diagnosis = { code: string; name: string };

export type Document = {
  id: string;
  filename: string;
  flagged?: boolean;
};

export type Treatment = string;

export type Visit = {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  type: VisitType;
  diagnosis: Diagnosis;
  treatments: Treatment[];
  document: Document;
  doctorName: string;
  doctorSpecialty: string;
};

export type AISummary = {
  paragraphs: string[];
};

export type KeyTrend = { id: string; label: string };

export type LastVisitInfo = {
  date: string;
  timeRange: string;
  type: string;
  doctorName: string;
  status: { tone: "success" | "warning"; label: string };
};

export type LastDiagnosisInfo = {
  code: string;
  name: string;
  setOnDate: string;
  status: string;
};

export const MOCK_PATIENT: PatientHeader = {
  id: "p1",
  fullName: "Юлдашев Иван Икромович",
  initials: "ЮИ",
  status: "active",
  age: 37,
  birthDate: "14.06.1988",
  phone: "+998 (91) 910-05-37",
  appointmentType: "Консультация",
  visitStatus: { tone: "success", label: "На приёме" },
  lastVisitShort: "13 мая, 09:00",
  cardNumber: "12547",
};

export const MOCK_META_CHIPS: MetaChip[] = [
  {
    id: "m1",
    icon: "allergy",
    label: "Аллергии",
    value: "не указано",
    tone: "destructive",
  },
  {
    id: "m2",
    icon: "chronic",
    label: "Хронические заболевания",
    value: "не указано",
    tone: "muted",
  },
  {
    id: "m3",
    icon: "medication",
    label: "Текущие препараты",
    value: "не указано",
    tone: "warning",
  },
];

export const MOCK_TIMELINE: TimelinePoint[] = [
  { id: "t1", date: "22.04.2025", type: "Консультация", doctorShort: "Д-р Рахимов Б.И." },
  { id: "t2", date: "18.04.2025", type: "Консультация", doctorShort: "Д-р Рахимов Б.И." },
  { id: "t3", date: "08.04.2025", type: "Консультация", doctorShort: "Д-р Рахимов Б.И." },
  { id: "t4", date: "22.02.2025", type: "Консультация", doctorShort: "Д-р Рахимов Б.И." },
  {
    id: "t5",
    date: "15.01.2025",
    type: "Консультация",
    doctorShort: "Д-р Рахимов Б.И.",
    current: true,
  },
];

export const MOCK_VISITS: Visit[] = [
  {
    id: "v1",
    date: "13.05.2025",
    timeStart: "09:00",
    timeEnd: "09:30",
    type: "consultation",
    diagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
    treatments: [
      "Мексидол 125 мг — по 1 таб. 2 р/д",
      "Глицин 100 мг — по 1 таб. 2 р/д",
      "Магний B6 — по 1 таб. 1 р/д, 30 дней",
    ],
    document: { id: "d1", filename: "Заключение 13.05.2025.pdf" },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
  {
    id: "v2",
    date: "22.04.2025",
    timeStart: "16:20",
    timeEnd: "16:50",
    type: "consultation",
    diagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
    treatments: [
      "Мексидол 125 мг — по 1 таб. 2 р/д",
      "Глицин 100 мг — по 1 таб. 2 р/д",
      "Витамин B1 — по 100 мг 1 р/д, 30 дней",
    ],
    document: { id: "d2", filename: "Заключение 22.04.2025.pdf", flagged: true },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
  {
    id: "v3",
    date: "18.04.2025",
    timeStart: "10:00",
    timeEnd: "10:30",
    type: "consultation",
    diagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
    treatments: [
      "Мексидол 125 мг — по 1 таб. 2 р/д",
      "Глицин 100 мг — по 1 таб. 2 р/д, 30 дней",
    ],
    document: { id: "d3", filename: "Заключение 18.04.2025.pdf" },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
  {
    id: "v4",
    date: "08.04.2025",
    timeStart: "11:30",
    timeEnd: "12:00",
    type: "consultation",
    diagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
    treatments: [
      "Мексидол 125 мг — по 1 таб. 2 р/д",
      "Глицин 100 мг — по 1 таб. 2 р/д",
    ],
    document: { id: "d4", filename: "Заключение 08.04.2025.pdf" },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
  {
    id: "v5",
    date: "22.02.2025",
    timeStart: "15:10",
    timeEnd: "15:40",
    type: "consultation",
    diagnosis: { code: "F43.0", name: "Острая реакция на стресс" },
    treatments: [
      "Афобазол 10 мг — по 1 таб. 3 р/д",
      "Магний B6 — по 1 таб. 1 р/д, 20 дней",
    ],
    document: { id: "d5", filename: "Заключение 22.02.2025.pdf" },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
  {
    id: "v6",
    date: "15.01.2025",
    timeStart: "09:45",
    timeEnd: "10:15",
    type: "repeat",
    diagnosis: { code: "F43.0", name: "Острая реакция на стресс" },
    treatments: [
      "Афобазол 10 мг — по 1 таб. 3 р/д",
      "Магний B6 — по 1 таб. 1 р/д",
    ],
    document: { id: "d6", filename: "Заключение 15.01.2025.pdf" },
    doctorName: "Д-р Рахимов Б.И.",
    doctorSpecialty: "Невролог",
  },
];

export const MOCK_VISITS_TOTAL = 8;

export const MOCK_AI_SUMMARY: AISummary = {
  paragraphs: [
    "У пациента наблюдается генерализованное тревожное расстройство с эпизодами острой реакции на стресс. Динамика положительная: отмечается снижение уровня тревоги, улучшение сна и общего самочувствия.",
    "Рекомендуется продолжить текущую терапию и контроль через 2 месяца.",
  ],
};

export const MOCK_KEY_TRENDS: KeyTrend[] = [
  { id: "kt1", label: "Снижение уровня тревожности" },
  { id: "kt2", label: "Улучшение сна и концентрации" },
  { id: "kt3", label: "Положительная динамика на фоне терапии" },
];

export const MOCK_LAST_VISIT: LastVisitInfo = {
  date: "13.05.2025",
  timeRange: "09:00 — 09:30",
  type: "Консультация",
  doctorName: "Д-р Рахимов Б.И.",
  status: { tone: "success", label: "На приёме" },
};

export const MOCK_LAST_DIAGNOSIS: LastDiagnosisInfo = {
  code: "F41.1",
  name: "Генерализованное тревожное расстройство",
  setOnDate: "13.05.2025",
  status: "Основной",
};
