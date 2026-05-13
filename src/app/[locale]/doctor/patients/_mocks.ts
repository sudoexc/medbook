export type Tab =
  | "all"
  | "active"
  | "new"
  | "watch"
  | "returned"
  | "dormant";

export type RiskLevel = "low" | "medium" | "high";
export type PatientStatusTone = "active" | "watch" | "dormant";

export type Patient = {
  id: string;
  fullName: string;
  initials: string;
  online?: boolean;
  age: number;
  phone: string;
  lastVisit: { date: string; time: string };
  lastDiagnosis: { code: string; name: string };
  status: { label: string; tone: PatientStatusTone };
  nextAppointment: { date: string; time: string } | null;
  risk: RiskLevel;
};

export type TabDef = {
  key: Tab;
  label: string;
  count: number;
  highlight?: "danger";
};

export const MOCK_TABS: TabDef[] = [
  { key: "all", label: "Все пациенты", count: 1248 },
  { key: "active", label: "Активные", count: 382 },
  { key: "new", label: "Новые", count: 89 },
  { key: "watch", label: "На контроле", count: 214 },
  { key: "returned", label: "Вернулись", count: 156 },
  { key: "dormant", label: "Давно не были", count: 397, highlight: "danger" },
];

export const MOCK_PATIENTS: Patient[] = [
  {
    id: "1",
    fullName: "Юлдашев Иван Икромович",
    initials: "ЮИ",
    online: true,
    age: 37,
    phone: "+998 (91) 910-05-37",
    lastVisit: { date: "13 мая 2025", time: "09:00" },
    lastDiagnosis: {
      code: "F41.1",
      name: "Генерализованное тревожное расстройство",
    },
    status: { label: "На приёме", tone: "active" },
    nextAppointment: { date: "20 мая 2025", time: "10:00" },
    risk: "low",
  },
  {
    id: "2",
    fullName: "Мухитдинова Шахноза Салахиддиновна",
    initials: "МС",
    age: 42,
    phone: "+998 (90) 123-45-67",
    lastVisit: { date: "8 мая 2025", time: "10:00" },
    lastDiagnosis: { code: "G44.2", name: "Головная боль напряжения" },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "22 мая 2025", time: "10:00" },
    risk: "medium",
  },
  {
    id: "3",
    fullName: "Бурханов Абдулазиз Икромович",
    initials: "БА",
    age: 29,
    phone: "+998 (93) 555-22-11",
    lastVisit: { date: "3 мая 2025", time: "10:30" },
    lastDiagnosis: { code: "F43.0", name: "Острая реакция на стресс" },
    status: { label: "На приёме", tone: "active" },
    nextAppointment: { date: "17 мая 2025", time: "09:30" },
    risk: "high",
  },
  {
    id: "4",
    fullName: "Каримова Адиба Фарходовна",
    initials: "КА",
    age: 34,
    phone: "+998 (97) 777-33-44",
    lastVisit: { date: "28 апр. 2025", time: "11:00" },
    lastDiagnosis: { code: "M54.2", name: "Цервикалгия" },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "19 мая 2025", time: "11:00" },
    risk: "low",
  },
  {
    id: "5",
    fullName: "Турсунова Феруза Камиловна",
    initials: "ТШ",
    age: 31,
    phone: "+998 (91) 234-56-78",
    lastVisit: { date: "22 апр. 2025", time: "09:30" },
    lastDiagnosis: { code: "G43.1", name: "Мигрень с аурой" },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "16 мая 2025", time: "09:30" },
    risk: "medium",
  },
  {
    id: "6",
    fullName: "Нигматуллина Ирина Олеговна",
    initials: "НИ",
    age: 45,
    phone: "+998 (99) 888-22-33",
    lastVisit: { date: "15 апр. 2025", time: "10:00" },
    lastDiagnosis: { code: "F51.0", name: "Неорганическая бессонница" },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "21 мая 2025", time: "10:00" },
    risk: "low",
  },
  {
    id: "7",
    fullName: "Рахмонов Мирзоход Сардорович",
    initials: "РМ",
    age: 52,
    phone: "+998 (90) 111-44-55",
    lastVisit: { date: "5 апр. 2025", time: "09:00" },
    lastDiagnosis: {
      code: "I67.9",
      name: "Цереброваскулярная болезнь, неуточнённая",
    },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "27 мая 2025", time: "09:30" },
    risk: "high",
  },
  {
    id: "8",
    fullName: "Сидорова Гульнора Бахтиёровна",
    initials: "СГ",
    age: 38,
    phone: "+998 (93) 222-66-77",
    lastVisit: { date: "2 апр. 2025", time: "11:30" },
    lastDiagnosis: { code: "F32.1", name: "Умеренный депрессивный эпизод" },
    status: { label: "Давно не был", tone: "dormant" },
    nextAppointment: null,
    risk: "high",
  },
  {
    id: "9",
    fullName: "Акбаров Комилжон Рустамович",
    initials: "АК",
    age: 27,
    phone: "+998 (91) 777-11-00",
    lastVisit: { date: "1 апр. 2025", time: "09:00" },
    lastDiagnosis: { code: "G44.0", name: "Кластерная головная боль" },
    status: { label: "Давно не был", tone: "dormant" },
    nextAppointment: null,
    risk: "high",
  },
  {
    id: "10",
    fullName: "Ли София Андреевна",
    initials: "ЛС",
    age: 36,
    phone: "+998 (97) 333-55-99",
    lastVisit: { date: "25 мар. 2025", time: "10:00" },
    lastDiagnosis: { code: "M79.7", name: "Фибромиалгия" },
    status: { label: "На контроле", tone: "watch" },
    nextAppointment: { date: "18 мая 2025", time: "10:00" },
    risk: "medium",
  },
];

export const MOCK_PAGINATION = {
  rangeFrom: 1,
  rangeTo: 10,
  total: 1248,
  currentPage: 1,
  totalPages: 125,
  pageSize: 10,
};

export type AiRecoTone = "danger" | "warning" | "info" | "success";
export type AiReco = {
  id: string;
  label: string;
  count: number;
  tone: AiRecoTone;
};

export const MOCK_AI_RECOS: AiReco[] = [
  { id: "1", label: "Пациенты с высоким риском no-show", count: 6, tone: "danger" },
  { id: "2", label: "Давно не посещали клинику", count: 5, tone: "warning" },
  { id: "3", label: "Нуждаются в контрольном визите", count: 8, tone: "info" },
  { id: "4", label: "Можно предложить ранний приём", count: 4, tone: "success" },
];

export const MOCK_AI_RECOS_TOTAL = 12;

export const MOCK_SELECTED_PATIENT = {
  id: "1",
  fullName: "Юлдашев Иван Икромович",
  initials: "ЮИ",
  statusLabel: "На приёме",
  age: 37,
  phone: "+998 (91) 910-05-37",
  lastVisit: "13 мая 2025, 09:00",
  diagnosis: { code: "F41.1", name: "Генерализованное тревожное расстройство" },
  status: "Активное наблюдение",
  nextAppointment: "20 мая 2025, 10:00",
  risk: "Низкий" as const,
};

export type SegmentTone = "active" | "watch" | "dormant" | "new" | "returned";
export type Segment = {
  key: SegmentTone;
  label: string;
  count: number;
  percent: number;
};

export const MOCK_SEGMENTS: Segment[] = [
  { key: "active", label: "На приёме", count: 382, percent: 30 },
  { key: "watch", label: "На контроле", count: 214, percent: 17 },
  { key: "dormant", label: "Давно не были", count: 397, percent: 32 },
  { key: "new", label: "Новые", count: 89, percent: 7 },
  { key: "returned", label: "Вернулись", count: 156, percent: 12 },
];

export const MOCK_SEGMENTS_TOTAL = 1248;
