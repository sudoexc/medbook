/**
 * Mock data for the "Мой день" page. Shapes mirror what the real API will
 * return so swapping in TanStack Query later is a 1-line change per block.
 */

export type ScheduleEntry = {
  id: string;
  startTime: string;
  patientName: string | null;
  type: "consultation" | "repeat" | "reserve" | "break";
  durationMin: number | null;
  status?: "in_progress" | "upcoming";
};

export type PatientTag = "active" | "first_visit" | "vip" | "new";

export type CurrentPatient = {
  id: string;
  fullName: string;
  age: number;
  birthDate: string;
  phone: string;
  avatarUrl?: string | null;
  tags: PatientTag[];
  appointmentRange: string;
  appointmentSecondsLeft: number;
  complaints: string;
  lastVisit: { date: string; title: string };
  lastDiagnosis: { codes: { code: string; name: string }[] };
};

export type UpcomingPatient = {
  id: string;
  shortName: string;
  startTime: string;
  durationMin: number;
  type: "consultation" | "repeat";
  avatarUrl?: string | null;
};

export type AISummary = {
  totalAppointments: number;
  consultations: number;
  repeats: number;
  dayPlanPercent: number;
};

export type AIAlert = {
  id: string;
  tone: "warning" | "info";
  title: string;
  description?: string;
};

export type AIRecommendation = {
  id: string;
  icon: "calendar" | "trend";
  title: string;
  description?: string;
};

export type TodayTask = {
  id: string;
  title: string;
  count: number;
  done?: boolean;
};

export type UnreadResult = {
  id: string;
  title: string;
  patientShort: string;
  date: string;
  isNew: boolean;
};

export type Reminder = {
  id: string;
  title: string;
  patientShort: string;
  inDaysLabel: string;
  dueDate: string;
};

export type QuickAction = {
  id: string;
  label: string;
  shortcut: string;
  icon: "new" | "patient" | "conclusion" | "analysis" | "template";
};

export type DraftConclusion = {
  id: string;
  title: string;
  patientShort: string;
  time: string;
};

export type RecentPatient = {
  id: string;
  shortName: string;
  date: string;
  avatarUrl?: string | null;
};

export const MOCK_SCHEDULE: ScheduleEntry[] = [
  {
    id: "s1",
    startTime: "09:00",
    patientName: "Турсунова Феруза Камиловна",
    type: "consultation",
    durationMin: 30,
    status: "in_progress",
  },
  {
    id: "s2",
    startTime: "09:30",
    patientName: "Мухитдинова Шахноза Салахиддиновна",
    type: "consultation",
    durationMin: 10,
  },
  {
    id: "s3",
    startTime: "10:00",
    patientName: "Бурхонов Абдулазиз Икромович",
    type: "repeat",
    durationMin: 45,
  },
  {
    id: "s4",
    startTime: "10:30",
    patientName: "Ахмедов Бекзод Равшанович",
    type: "consultation",
    durationMin: 60,
  },
  {
    id: "s5",
    startTime: "11:30",
    patientName: null,
    type: "reserve",
    durationMin: 30,
  },
  {
    id: "s6",
    startTime: "12:00",
    patientName: null,
    type: "break",
    durationMin: null,
  },
];

export const MOCK_CURRENT_PATIENT: CurrentPatient = {
  id: "p1",
  fullName: "Турсунова Феруза Камиловна",
  age: 37,
  birthDate: "14.06.1988",
  phone: "+998 (91) 910-05-37",
  avatarUrl: null,
  tags: ["active", "first_visit"],
  appointmentRange: "Запись на 13 мая, 09:00 — 09:30",
  appointmentSecondsLeft: 12 * 60 + 47,
  complaints:
    "Головные боли в затылочной области, головокружение, тошнота по утрам, повышенная утомляемость.",
  lastVisit: { date: "28.04.2025", title: "Консультация невролога" },
  lastDiagnosis: {
    codes: [
      { code: "G44.2", name: "Головная боль напряжения" },
      { code: "M54.2", name: "Цервикогенная головная боль" },
    ],
  },
};

export const MOCK_UPCOMING: UpcomingPatient[] = [
  {
    id: "u1",
    shortName: "Мухитдинова Ш.С.",
    startTime: "09:30",
    durationMin: 10,
    type: "consultation",
  },
  {
    id: "u2",
    shortName: "Бурхонов А.И.",
    startTime: "10:00",
    durationMin: 45,
    type: "repeat",
  },
  {
    id: "u3",
    shortName: "Ахмедов Б.Р.",
    startTime: "10:30",
    durationMin: 60,
    type: "consultation",
  },
  {
    id: "u4",
    shortName: "Насриддинова Д.С.",
    startTime: "11:30",
    durationMin: 30,
    type: "consultation",
  },
  {
    id: "u5",
    shortName: "Юлдашев И.И.",
    startTime: "12:00",
    durationMin: 30,
    type: "repeat",
  },
];

export const MOCK_AI_SUMMARY: AISummary = {
  totalAppointments: 12,
  consultations: 9,
  repeats: 3,
  dayPlanPercent: 100,
};

export const MOCK_AI_ALERTS: AIAlert[] = [
  {
    id: "a1",
    tone: "warning",
    title: "2 результата без просмотра",
    description: "Просмотрите результаты анализов",
  },
  {
    id: "a2",
    tone: "warning",
    title: "Напоминание о контрольных приёмах",
    description: "3 пациента ожидают повторного приёма",
  },
];

export const MOCK_AI_RECOMMENDATIONS: AIRecommendation[] = [
  {
    id: "r1",
    icon: "calendar",
    title: "У 2 пациентов запланирован контроль",
    description: "Рекомендуется связаться",
  },
  {
    id: "r2",
    icon: "trend",
    title: "Высокая нагрузка в 10:00—11:30",
    description: "Возможно смещение времени",
  },
];

export const MOCK_TASKS: TodayTask[] = [
  { id: "t1", title: "Просмотреть результаты анализов", count: 2 },
  { id: "t2", title: "Подписать черновики заключений", count: 3 },
  { id: "t3", title: "Ответить на сообщения", count: 2 },
  { id: "t4", title: "Позвонить пациентам", count: 1 },
  { id: "t5", title: "Проверить назначения", count: 4 },
];

export const MOCK_UNREAD_RESULTS: UnreadResult[] = [
  {
    id: "ur1",
    title: "Анализ крови общий",
    patientShort: "Мухитдинова Ш.С.",
    date: "12.05.2025",
    isNew: true,
  },
  {
    id: "ur2",
    title: "МРТ головного мозга",
    patientShort: "Бурхонов А.И.",
    date: "11.05.2025",
    isNew: true,
  },
  {
    id: "ur3",
    title: "УЗИ сосудов шеи",
    patientShort: "Ахмедов Б.Р.",
    date: "10.05.2025",
    isNew: true,
  },
];

export const MOCK_REMINDERS: Reminder[] = [
  {
    id: "rm1",
    title: "Контрольный приём",
    patientShort: "Турсунова Ф.К.",
    inDaysLabel: "через 14 дней",
    dueDate: "13.05.2025",
  },
  {
    id: "rm2",
    title: "Повторный приём",
    patientShort: "Насриддинова Д.С.",
    inDaysLabel: "через 21 день",
    dueDate: "20.05.2025",
  },
  {
    id: "rm3",
    title: "Контроль анализов",
    patientShort: "Юлдашев И.И.",
    inDaysLabel: "через 7 дней",
    dueDate: "14.05.2025",
  },
];

export const MOCK_QUICK_ACTIONS: QuickAction[] = [
  { id: "qa1", label: "Новая запись", shortcut: "F2", icon: "new" },
  { id: "qa2", label: "Открыть карту пациента", shortcut: "F3", icon: "patient" },
  { id: "qa3", label: "Создать заключение", shortcut: "F4", icon: "conclusion" },
  { id: "qa4", label: "Направление на анализы", shortcut: "F5", icon: "analysis" },
  { id: "qa5", label: "Шаблоны документов", shortcut: "F6", icon: "template" },
];

export const MOCK_DRAFTS: DraftConclusion[] = [
  {
    id: "d1",
    title: "Консультация от 13.05.2025",
    patientShort: "Турсунова Ф.К.",
    time: "09:02",
  },
  {
    id: "d2",
    title: "Повторный приём от 12.05.2025",
    patientShort: "Бурхонов А.И.",
    time: "15:30",
  },
  {
    id: "d3",
    title: "Консультация от 12.05.2025",
    patientShort: "Ахмедов Б.Р.",
    time: "11:15",
  },
];

export const MOCK_RECENT_PATIENTS: RecentPatient[] = [
  { id: "rp1", shortName: "Турсунова Ф.К.", date: "28.04.2025" },
  { id: "rp2", shortName: "Мухитдинова Ш.С.", date: "27.04.2025" },
  { id: "rp3", shortName: "Бурхонов А.И.", date: "26.04.2025" },
  { id: "rp4", shortName: "Ахмедов Б.Р.", date: "25.04.2025" },
];
