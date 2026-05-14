# Doctor «Рабочее пространство» — ТЗ на реальные данные

> Pinned spec для группы «Рабочее пространство» в сайдбаре врача (`doctor-sidebar.tsx`, группа `workspace`). Цель — выпилить **все** моки и заглушки, каждая кнопка / бейдж / число должна биться с реальной БД. Документ живёт здесь чтобы не терять контекст между сессиями.

**Локали:** все API — RU-first, UI берёт строки из `next-intl`.
**База:** Prisma 7, Postgres, multi-tenant через `runWithTenant()` + `clinicId`.
**Realtime:** SSE через `/api/events`, инвалидация через `useLiveQueryInvalidation`.
**Query keys:** `["doctor", "me", <feature>, ...args]` (конвенция уже сложилась).

---

## 0. Состояние моделей в Prisma (важно!)

| Модель | Существует? | Использовать для |
|---|---|---|
| `VisitNote` (DRAFT/FINALIZED) | ✅ | Визиты, Заключения, Черновики |
| `Appointment` | ✅ | Расписание, бейджи дня |
| `Conversation` + `Message` | ✅ | Сообщения, бейдж непрочитанного |
| `Prescription` | ✅ | Reception → таб «Назначения» |
| `PatientDocument` | ✅ | Reception → таб «Документы» |
| `Action` | ✅ | My Day → «Задачи» (репурпос) |
| `Reminder` | ❌ → **добавляем в Фазе 5a** | My Day «Напоминания» |
| `LabResult` | ❌ → **добавляем в Фазе 5a** | My Day «Результаты» + Reception «Анализы» |

Решение Джавохира 2026-05-14: «нужно сразу нормально сделать в майдей … если нужно что-то поднять новую делай но без мокапов». Все 10 карточек wire по-настоящему, миграции — отдельная фаза перед wire-фазой.

---

## Фаза 1 — Sidebar stats (~2-3 часа)

### Что делаем
Один эндпоинт, один хук, один компонент. Самая быстрая победа.

### API
**`GET /api/crm/doctors/me/sidebar-stats`**

```ts
type SidebarStatsResponse = {
  todayBadge: number;        // appointment count for today, status in [SCHEDULED, CONFIRMED, IN_PROGRESS]
  unreadMessages: number;    // sum(unreadCount) across conversations assigned to this doctor
  loadPercent: number;       // 0..100 — booked slots / total daily capacity for this doctor today
  todayCount: number;        // total appointments today excluding CANCELLED
}
```

**Источники:**
- `todayBadge`, `todayCount` → `prisma.appointment.findMany({ where: { doctorId, date: { gte: startOfDay, lt: endOfDay } } })`
- `loadPercent` → нужен `Doctor.dailySlotCapacity` (или константа `DEFAULT_DAILY_SLOTS = 16`). Если поля нет — добавить в `Doctor` модель миграцией ИЛИ хардкодить 16 в утиле `getDailyCapacity(doctorId)` с TODO.
- `unreadMessages` → `prisma.conversation.aggregate({ where: { doctorId }, _sum: { unreadCount: true } })`

**Auth:** `auth()` → проверить `role === "DOCTOR"`, иначе 403. Обернуть в `runWithTenant({ kind: "TENANT", ... })`.

### Hook
**`src/app/[locale]/doctor/_hooks/use-doctor-sidebar-stats.ts`**

```ts
const sidebarStatsKey = ["doctor", "me", "sidebar-stats"] as const;

export function useDoctorSidebarStats() {
  const q = useQuery({
    queryKey: sidebarStatsKey,
    queryFn: () => fetch("/api/crm/doctors/me/sidebar-stats").then(r => r.json()),
    staleTime: 30_000,
  });
  useLiveQueryInvalidation({
    events: ["appointment.statusChanged", "appointment.created", "appointment.cancelled", "tg.message.new"],
    queryKey: sidebarStatsKey,
  });
  return q;
}
```

### UI
**`doctor-sidebar.tsx`:**
- Превратить в client-component-обёртку, которая вызывает хук.
- Удалить `badge: 7` (строка 46) и `badge: 2` (строка 52) из `DOCTOR_NAV`.
- Бейджи рендерить динамически: пройтись по `item.href`, для `my-day` → `data.todayBadge`, для `messages` → `data.unreadMessages`.
- DonutGauge (строки 157-158): пробросить `loadPercent` и `todayCount` из хука. Скелетон если `isLoading`.

### DoD
- Открыл врача → бейджи реальные.
- Сменил статус appointment в CRM (через recepionist UI) → бейдж my-day обновился ≤500мс.
- Прочитал сообщение → бейдж messages уменьшился.

---

## Фаза 2 — Patients: real detail page + dead buttons + messages autoselect (~3-4 часа)

Расширенный скоуп (Джавохир 2026-05-14: «сложный но правильный путь»).

### 2.1 Sidebar-карточка пациента
- `src/app/[locale]/doctor/patients/_components/selected-patient-card.tsx:11` — убрать `MOCK_SELECTED_PATIENT`, тянуть из `useDoctorPatientSummary(id)` (новый хук → `/api/crm/doctors/me/patients/[id]/summary`, эндпоинт уже есть).
- Query key `["doctor","me","patient",id,"summary"]`. SSE: `patient.summary.refreshed`.

### 2.2 Полная страница пациента
Новый роут **`src/app/[locale]/doctor/patients/[id]/page.tsx`** (server component) + клиентский компонент с табами:
- Шапка: ФИО, возраст, телефон, аллергии (chips), хроника (chips), теги.
- Табы (по тому же паттерну, что reception session-tabs):
  - **Обзор** — рендер `selected-patient-card` контента (но full-width)
  - **История визитов** — `useDoctorPatientVisits(id)` (хук-обёртка над `/patients/[id]/visits`)
  - **Документы** — `useDoctorPatientDocuments(id)` (новый эндпоинт `GET /api/crm/doctors/me/patients/[id]/documents`)
  - **Назначения** — `useDoctorPatientPrescriptions(id)` (новый эндпоинт `GET /api/crm/doctors/me/patients/[id]/prescriptions`)
  - **Анализы** — `useDoctorPatientLabs(id)` (после Фазы 5a; до того — скрыт)
- Auth: `auth()` + проверка что этот пациент когда-либо был у этого врача (`exists Appointment where doctorId=me AND patientId=:id`) → иначе 404.

Эти 3 эндпоинта (`documents`, `prescriptions`, `labs`) — те же, что нужны и для reception session-tabs (Фаза 3). Делаем один раз, переиспользуем.

### 2.3 Patients table — dropdown actions
`src/app/[locale]/doctor/patients/_components/patients-table.tsx:241-255`:
- **«Написать»** → `router.push("/" + locale + "/doctor/messages?patientId=" + id)`. Messages-страница обновлена в 2.4 чтобы это работало.
- **«Ещё действия»** → `DropdownMenu` (shadcn/ui, уже подключён в проекте):
  - «Открыть карту» → `/doctor/patients/[id]` (новая страница из 2.2)
  - «История визитов» → `/doctor/patients/[id]?tab=visits` (или `/doctor/visits/[id]`)
  - «Новое заключение» → `/doctor/conclusions/new?patientId=[id]` (если в conclusions/new нет чтения param — добавить)

### 2.4 Messages auto-select по `?patientId=`
- В `src/app/[locale]/doctor/messages/_hooks/messages-context.tsx` или странице добавить чтение `useSearchParams().get("patientId")`.
- При наличии — найти/создать conversation для этого пациента (через существующий `findOrCreateConversation` если есть; иначе — новый эндпоинт `POST /api/crm/doctors/me/conversations/find-or-create` с body `{ patientId }`).
- Установить как `selectedConversationId`, прокрутить тред.
- Если у пациента нет канала связи (телефон без Telegram) — показать toast «Нет канала связи с пациентом».

### DoD
- `grep MOCK_SELECTED_PATIENT src/` → пусто.
- `/doctor/patients/[id]` отдаёт полную страницу с 4 (или 5 после 5a) табами.
- Все 3 пункта dropdown → реальные страницы.
- Из patients table «Написать» → messages открывает нужный тред автоматом.
- Прямой URL `/doctor/messages?patientId=cuid_abc` тоже работает.

---

## Фаза 3 — Reception fixes (~3-4 часа)

### 3.1 AI panel fallback
**`ai-summary-panel.tsx:7`** — выкинуть импорт `MOCK_AI_SUMMARY`, `MOCK_KEY_TRENDS`. Рендер только из реального ответа `/api/crm/visit-notes/*/ai`. Пустое состояние = скелетон + текст «AI ещё анализирует визит».

### 3.2 Print button (active-patient-card.tsx:175)
- Убрать `disabled`.
- Прикрутить новый эндпоинт **`GET /api/crm/visit-notes/[id]/print`** → возвращает HTML страницу с `Content-Type: text/html`, заголовок `Content-Disposition: inline`.
- На клиенте: `window.open(url, "_blank")` → пользователь печатает через браузер.
- Аудит: `audit("VISIT_NOTE_PRINT", { visitNoteId })`.

### 3.3 Session tabs (`session-tabs.tsx`)
Локальный `useState<TabKey>` в `reception/page.tsx` или контексте reception. 5 табов:

| Таб | Контент | Источник | В этой фазе? |
|---|---|---|---|
| Приём | Текущий рендер (форма visit-note) | уже есть | ✅ default |
| История визитов | Список визитов пациента | переиспользовать `useDoctorPatientVisits()` (новый хук-обёртка над `/patients/[id]/visits`) | ✅ |
| Документы | Список документов пациента | новый эндпоинт **`GET /api/crm/doctors/me/patients/[id]/documents`** → `PatientDocument` фильтр по patientId | ✅ |
| Анализы | Список `LabResult` для пациента | новый эндпоинт **`GET /api/crm/doctors/me/patients/[id]/labs`** (после Фазы 5a) | ✅ (после 5a) |
| Назначения | Список рецептов пациента | новый эндпоинт **`GET /api/crm/doctors/me/patients/[id]/prescriptions`** → `Prescription` фильтр по patientId | ✅ |

Каждый таб — отдельный компонент с собственным `useQuery`. Ленивая загрузка (фетч только при первом открытии таба).

### DoD
- Все 4 рабочих таба переключаются, данные грузятся.
- Print открывает новое окно с HTML визит-нота, печать работает.
- AI панель не рендерит мок-строки даже когда `/ai` отдаёт пустоту.

---

## Фаза 4 — Visits buttons + Export (~2-3 часа)

**Compare выпиливается полностью** (решение Джавохира 2026-05-14: «не нужно сравнивать пациентов»). Не скрываем — удаляем код кнопки, иконку, обработчик, перевод. Из бэклога тоже убираем.

**`visits-list.tsx`:**
- Стрелки таймлайна (`:147`): horizontal scroll через `ref.current.scrollBy({ left: ±300, behavior: "smooth" })`.
- «Открыть» (`:380-389`): `router.push("/doctor/visits/" + patientId + "/" + visitId)` — **создать** страницу `[locale]/doctor/visits/[patientId]/[visitId]/page.tsx` (server-side fetch visit-note + рендер `VisitNoteCard` в readonly). 404 если visit-note чужой.
- **«Сравнить»: удалить** строки кнопки целиком.

**Export в шапке:**
- Реализуем **полноценно**: `GET /api/crm/doctors/me/patients/[id]/visits/export?format=csv` → CSV (visit-date, диагноз, doctor, summary).
- На клиенте: `<a href download>`.
- Audit: `VISIT_LIST_EXPORTED`.

### DoD
- Стрелки скроллят влево/вправо.
- «Открыть» → реальный визит в readonly.
- Compare-кнопки нет в коде (grep `Compare|Сравнить`).
- Export скачивает CSV.

---

## Фаза 5a — Миграции `Reminder` + `LabResult` (~2-3 часа)

**Делаем перед Фазой 5**, чтобы my-day и reception «Анализы» имели реальные таблицы под собой.

### 5a.1 `Reminder` модель

```prisma
model Reminder {
  id          String   @id @default(cuid())
  clinicId    String
  doctorId    String   // owner врач
  patientId   String?  // optional — может быть "general" reminder
  appointmentId String? // optional — привязка к визиту (follow-up)
  title       String
  body        String?  @db.Text
  remindAt    DateTime
  status      ReminderStatus @default(PENDING)
  completedAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  clinic      Clinic   @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  doctor      User     @relation("DoctorReminders", fields: [doctorId], references: [id])
  patient     Patient? @relation(fields: [patientId], references: [id])
  appointment Appointment? @relation(fields: [appointmentId], references: [id])

  @@index([clinicId, doctorId, status, remindAt])
  @@index([patientId])
}

enum ReminderStatus {
  PENDING
  DONE
  DISMISSED
  SNOOZED
}
```

**CRUD-эндпоинты:**
- `GET /api/crm/doctors/me/reminders?status=&limit=` → list (default только PENDING+SNOOZED где remindAt ≤ now+24h)
- `POST /api/crm/doctors/me/reminders` → create
- `PATCH /api/crm/doctors/me/reminders/[id]` → mark DONE / DISMISSED / SNOOZED (+remindAt)
- `DELETE /api/crm/doctors/me/reminders/[id]` → soft delete (status=DISMISSED)

**SSE event:** `reminder.created`, `reminder.updated`. Регистрируем в `src/server/realtime/events.ts`.

**RLS:** через `runWithTenant`. Доктор видит только свои reminders (где `doctorId = userId`). ADMIN видит все по клинике (для админских отчётов потом).

**Audit:** `REMINDER_CREATED`, `REMINDER_COMPLETED`, `REMINDER_DISMISSED` в `AUDIT_ACTION`.

### 5a.2 `LabResult` модель

MVP-форма (одна таблица, без LabOrder). Когда придёт интеграция с лабораторной системой — расширим.

```prisma
model LabResult {
  id           String   @id @default(cuid())
  clinicId     String
  patientId    String
  doctorId     String   // ordering врач (кому уведомлять)
  appointmentId String? // visit-note source (optional)
  visitNoteId  String?  // explicit link

  testName     String   // «Глюкоза», «Гемоглобин» etc.
  testCode     String?  // LOINC / local
  value        String   // строкой чтобы поддержать диапазоны, qualitative («положит.»)
  unit         String?
  refRange     String?  // «3.5-5.5»
  flag         LabFlag? // HIGH / LOW / CRITICAL / NORMAL
  notes        String?  @db.Text

  status       LabStatus @default(PENDING)
  receivedAt   DateTime  @default(now())
  reviewedAt   DateTime?
  reviewedBy   String?   // userId who marked reviewed

  attachmentUrl String?  // PDF/scan (MinIO)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  clinic      Clinic   @relation(fields: [clinicId], references: [id], onDelete: Cascade)
  patient     Patient  @relation(fields: [patientId], references: [id])
  doctor      User     @relation("DoctorLabResults", fields: [doctorId], references: [id])
  appointment Appointment? @relation(fields: [appointmentId], references: [id])
  visitNote   VisitNote?   @relation(fields: [visitNoteId], references: [id])

  @@index([clinicId, doctorId, status, receivedAt])
  @@index([patientId, receivedAt])
}

enum LabStatus {
  PENDING     // ждём результат
  RESULTED    // пришёл, врач ещё не смотрел
  REVIEWED    // врач отметил прочитанным
  ARCHIVED
}

enum LabFlag {
  NORMAL
  LOW
  HIGH
  CRITICAL
}
```

**Эндпоинты:**
- `GET /api/crm/doctors/me/labs/unread` → status=RESULTED, doctorId=me, paginate
- `GET /api/crm/doctors/me/patients/[id]/labs` → все labs пациента (для reception таба)
- `PATCH /api/crm/doctors/me/labs/[id]` → set status=REVIEWED + `reviewedAt`/`reviewedBy`
- `POST /api/crm/doctors/me/labs` → manual entry (врач сам вводит результат до интеграции с лабсистемой)

**SSE:** `lab.result.received`, `lab.result.reviewed`. Регистрируем.

**Audit:** `LAB_RESULT_CREATED`, `LAB_RESULT_REVIEWED`.

**Сидинг:** дев-сид (`prisma/seed.ts` или отдельный `seed-doctor-demo.ts`) — для каждого врача нашей dev клиники добавить 3-5 RESULTED записей чтобы карточка не была пустой при разработке.

### 5a.3 DoD фазы 5a
- `npx prisma migrate dev --name add_reminder_lab_result` проходит локально.
- `npx prisma generate` → клиент обновлён.
- Юнит-тесты на CRUD reminders (`tests/integration/reminders.test.ts`) и labs (`tests/integration/labs.test.ts`).
- Dev-сид добавляет демо-данные.
- `audit-actions.ts` обновлён.
- `events.ts` обновлён 4 новыми типами.

---

## Фаза 5 — My Day (~6-8 часов, самая жирная)

### 5.0 Все 10 карточек — wire полностью

| Карточка | Источник |
|---|---|
| Расписание | `Appointment` сегодня для doctor |
| Текущий пациент | `Appointment` IN_PROGRESS для doctor (или ближайший SCHEDULED через 15 мин) |
| Следующие пациенты | `Appointment` SCHEDULED/CONFIRMED сегодня после `now` |
| AI summary | агрегат по сегодняшним visit-notes + LLM-сжатие (переиспользовать `/api/crm/visit-notes/*/ai`) |
| AI alerts | критичные labs (`LabResult.flag = CRITICAL`) + аллергии у сегодняшних пациентов |
| AI recommendations | `/ai/recommendations` агрегат по дню |
| Задачи | `Action` модель, filter `assigneeId = me` + status OPEN |
| Напоминания | `Reminder` модель (Фаза 5a), status PENDING + remindAt ≤ now+24h |
| Непрочитанные результаты | `LabResult` status RESULTED, doctorId=me, top-5 |
| Черновики заключений | `VisitNote` status DRAFT, doctorId=me, top-5 |
| Недавние пациенты | distinct по `Appointment.patientId` где doctorId=me, последние 5 |
| Быстрые действия | статичный массив + навигация (не данные) |

### 5.1 Главный агрегат
**`GET /api/crm/doctors/me/today`** — один запрос, все сегодняшние данные:

```ts
type TodayResponse = {
  schedule: ScheduleEntry[];          // appointments today
  current: CurrentPatient | null;     // IN_PROGRESS appointment, null если нет
  upcoming: UpcomingPatient[];        // следующие SCHEDULED/CONFIRMED today
  ai: {
    summary: string | null;           // агрегат от LLM по сегодняшним visit-notes
    alerts: AIAlert[];                // критичные labs + аллергии у сегодняшних
    recommendations: AIRecommendation[];
  };
  actionItems: ActionItem[];          // Action.assigneeId = me, status OPEN
  reminders: ReminderItem[];          // Reminder.status PENDING + remindAt ≤ now+24h (top-5)
  unreadResults: LabResultItem[];     // LabResult status=RESULTED, doctorId=me (top-5)
  drafts: DraftItem[];                // VisitNote status=DRAFT, doctorId=me (top-5 + count)
  recentPatients: RecentPatient[];    // distinct patientId, последние 5
};
```

**SSE:** `appointment.*`, `action.created`, `action.updated`, `case.soap-draft.refreshed`, `reminder.created`, `reminder.updated`, `lab.result.received`, `lab.result.reviewed` → инвалидируют `["doctor","me","today"]`.

### 5.2 Хуки
- `useDoctorToday()` — главный хук с `useLiveQueryInvalidation`.
- Карточки берут срезы через `select` опцию `useQuery` чтобы не ререндериться зря.

### 5.3 Удалить
- `_mocks.ts` (339 строк) — после миграции, всё.
- Импорты `MOCK_*` — все 10 компонентов.

### DoD
- Открыл /doctor/my-day → ни одного мок-импорта (grep по `MOCK_` под `doctor/my-day/`).
- Назначил пациента на сегодня → расписание обновилось в реалтайме.
- Заполнил визит → черновик появился в «Черновики заключений».
- Завёл reminder через POST → появился в карточке «Напоминания» (через SSE).
- Создал LabResult через сид/POST → попал в «Непрочитанные результаты».
- Все 10 карточек рендерят реальные данные (или скелетон / empty-state).

---

## Фаза 6 (backlog) — отдельные фичи

**Не в текущем спринте:**

1. **Lab-system интеграция** — пуллер из внешнего лабораторного API, авто-создаёт `LabResult`. Пока — manual entry.
2. **Reminder автогенерация** — из visit-note SOAP-плана извлекать follow-up даты и создавать reminders автоматом.

**Permanently descoped** (не делать без явного запроса):
- ~~Compare-визитов~~ — Джавохир 2026-05-14: «не нужно сравнивать пациентов».

---

## Глобальные принципы для всех фаз

1. **Никаких новых моков.** Если данных нет — скелетон или пустое состояние, не fake-data.
2. **`runWithTenant` обязателен** во всех новых API роутах. Без него Postgres RLS уронит запрос.
3. **`audit()` на любое изменение** (Print, Export, бейдж-клик-агрегаты — нет, только мутации).
4. **SSE-инвалидация:** каждый новый `useQuery` для доктора **обязан** подписаться хотя бы на один event, иначе свежесть данных не гарантируется.
5. **Query-key конвенция:** `["doctor", "me", feature, ...args]`. Не отклоняться.
6. **Тесты:** на каждый новый API — `tests/integration/<route>.test.ts` (использовать существующий harness, посмотреть `tests/integration/crm-patients.test.ts`).

---

## Прогресс-чекбокс

- [x] **Фаза 1** — Sidebar stats endpoint + hook + wire ✅
- [x] **Фаза 2** — Patients: real `[id]` page (4 таба) + dropdown actions + messages `?patientId=` autoselect ✅
- [x] **Фаза 3** — Reception (AI fallback, Print, session-tabs ×4 без «Анализов») ✅
- [x] **Фаза 4** — Visits scroll/open/export, **remove** compare; новая страница `/doctor/visits/[patientId]/[visitId]` ✅
- [x] **Фаза 5a** — Миграции `Reminder` + `LabResult` (+ сид, audit-actions, events) ✅
- [x] **Фаза 5** — My Day full wire (все 10 карточек) ✅
- [x] **Фаза 5b** — reception «Анализы» таб + добавлен в /patients/[id] (LabsSection + useDoctorPatientLabs) ✅
- [ ] **Фаза 6 (backlog)** — Lab-system интеграция, Reminder автогенерация

Деплой — только по явному приказу Джавохира. Между фазами останавливаемся в локалке, отчёт + диф.
