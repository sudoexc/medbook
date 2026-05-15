# Doctor account — Finishing TZ (post-MyDay)

> Pinned spec для того что **осталось** после _WORKSPACE_TZ.md (фазы 1–5b закрыты, AI — Phase 3b в _ROADMAP.md). Здесь — всё что AI **не трогает**: дотягиваем placeholder-страницы, домокапиваем мёртвые кнопки, чистим хвосты от мокапов.
>
> Last updated: 2026-05-15.
>
> **Контекст состояния:** /doctor/my-day полностью wired, sidebar-stats live, reception/visits/conclusions/patients[id]/messages — рабочие. Остались: placeholder pages из sidebar групп «Коммуникации», «Аналитика», «Настройки», два мок-импорта на /doctor/patients и две мёртвые кнопки в reception/visits.

**Глобальные принципы (наследуем из _WORKSPACE_TZ.md):**
- `runWithTenant` на каждой ручке; query-key `["doctor","me",feature,...args]`; SSE-инвалидация обязательна на любой `useQuery`; audit на любую мутацию; никаких новых моков.

---

## 0. Регрессия — чинить **прямо сейчас**

`/doctor/my-day` — карточка «Напоминания» в последнем деплое (2026-05-15) направляет футер на `/doctor/notifications`, который рендерит `<PlaceholderPage>`. До завершения Фазы 7 (ниже) — **временно** перенаправить футер на первый ремайндер с `patientId` (как уже делает строка), либо на `/doctor/my-day#reminders`. Постоянное решение — Фаза 7.

**Decision:** оставляем линк как есть (`/doctor/notifications`), Фазу 7 делаем первой в этом TZ — placeholder заменим сегодня.

---

## Фаза 7 — Уведомления (`/doctor/notifications`) (~3-4 часа)

### Что делаем
Полноценная страница управления напоминаниями. CRUD-эндпоинты `Reminder` существуют (`/api/crm/doctors/me/reminders` GET/POST + `[id]` PATCH/DELETE), нужен только UI.

### UI (`/doctor/notifications/page.tsx`)

Заменяем `<PlaceholderPage>` на client-страницу:

**Шапка:**
- Заголовок «Уведомления» + кнопка **«Создать напоминание»** справа → открывает модалку.

**Табы (URL-driven `?tab=`):**
| Таб | Фильтр | Default |
|---|---|---|
| Актуальные | `status=PENDING,SNOOZED`, всё horizon | ✅ |
| Выполненные | `status=DONE`, последние 30 дней | |
| Архив | `status=DISMISSED`, последние 30 дней | |

Запрос: `useDoctorReminders({ status })` → новый хук-обёртка над `GET /api/crm/doctors/me/reminders?status=ALL` (отдельный fetch на таб, или один запрос с `status=ALL` + локальный split — выбираем второе, проще для SSE-инвалидации).

**Список:**
- Каждая строка: иконка bell + title + body (truncate 2 lines) + patient pill (если есть) + relative time («через 2 ч»/«просрочено 3 ч») + status badge.
- Hover → две action-кнопки: **«Готово»** (status=DONE) и **«⋮»** dropdown:
  - Отложить на 1 час / 4 часа / завтра 9:00 (status=SNOOZED + remindAt)
  - Удалить (status=DISMISSED, confirm dialog)
  - Если есть `patientId` — «Открыть пациента»
- Пустое состояние per-tab: «Ничего нет», иконка, призыв создать первое.

**Модалка создания (shadcn `Dialog`):**
- Поля: title (req), body (opt, textarea), remindAt (date+time picker, default = сейчас+1ч), patient picker (combobox, по `/api/crm/patients?q=` — переиспользовать существующий), appointment picker (опционально, после patient — список будущих appointments этого пациента).
- POST → закрыть → SSE инвалидирует список → новый ремайндер появляется наверху таба «Актуальные».

### Hook
`src/app/[locale]/doctor/notifications/_hooks/use-doctor-reminders.ts`:
```ts
const remindersKey = ["doctor","me","reminders"] as const;
// один запрос со status=ALL, локально режем по табам
useLiveQueryInvalidation({
  events: ["reminder.created","reminder.updated"],
  queryKey: remindersKey,
});
```

### Footer ссылок снаружи (cleanup)
- `/doctor/my-day` → карточка «Напоминания» футер: **сменить** target с `/doctor/notifications` (всё ещё placeholder в момент линковки) на… **остаётся** `/doctor/notifications` — это и есть новая страница. Регрессия закрыта самим деплоем Фазы 7.

### DoD
- `/doctor/notifications` рендерит реальные ремайндеры в 3 табах.
- Создание/выполнение/откладывание/удаление работают, audit пишется.
- SSE: открыто 2 окна доктора → POST в одном → второе обновляется ≤500мс.
- `grep "PlaceholderPage" src/app/[locale]/doctor/notifications/` → пусто.

---

## Фаза 8 — Patients sidebar: убрать оставшиеся моки (~1.5-2 часа)

### 8.1 SegmentationCard — wire to real cohorts

Карточка сейчас рендерит `MOCK_SEGMENTS` (см. `patients/_components/segmentation-card.tsx:5-6`). Решение Джавохира 2026-05-13: «без мокапов».

**Скоуп врача:** сегментация ТОЛЬКО по «моим пациентам» (тем, у кого есть appointment с этим doctorId). Не общеклинический срез — это уже есть в `/crm/analytics`.

**Новая ручка:** **`GET /api/crm/doctors/me/patient-segments`**
```ts
type SegmentResponse = {
  total: number;            // всего «моих» пациентов
  segments: Array<{
    key: "active" | "new" | "returning" | "dormant" | "first_visit";
    label: string;          // RU
    count: number;
    percent: number;        // 0..100, округлено до 1 знака после запятой
    tone: SegmentTone;      // совпадает с COLOR в карточке
  }>;
};
```

**Логика классификации** (запрос за один проход по `Appointment`):
- Получить distinct patientId где `doctorId = me`.
- Для каждого: `visitsCount`, `lastVisitAt`.
  - `active` — `lastVisitAt` ≤ 90 дней назад
  - `dormant` — `lastVisitAt` > 180 дней назад
  - `returning` — `visitsCount ≥ 3` И `lastVisitAt` 90-180 дней назад
  - `new` — `Patient.segment === "NEW"` (поле уже есть)
  - `first_visit` — `visitsCount === 1`
- Перекрытия: брать первый матч в порядке выше (active побеждает dormant и т.д.).

**Hook:** `use-doctor-patient-segments.ts`, key `["doctor","me","patient-segments"]`, SSE: `appointment.completed`, `patient.created`. staleTime 5 мин — это слабо-меняющиеся данные.

**UI:** заменить импорты, убрать `MOCK_SEGMENTS_TOTAL` (заменить на `data.total`). Скелетон + empty-state («Пока нет пациентов»).

**RLS:** `runWithTenant` обязателен, фильтр по `clinicId` + `doctorId`.

### 8.2 SelectedPatientCard — проверить, не моки ли всё ещё

`grep MOCK_SELECTED_PATIENT src/` — по _WORKSPACE_TZ.md должно быть уже пусто (Phase 2 DoD). Если grep что-то находит — добиваем. (По текущему grep — `MOCK_SELECTED_PATIENT` живёт только в `_mocks.ts` определении, не используется. Можно удалить из `_mocks.ts`.)

### 8.3 Cleanup `_mocks.ts`
После Фазы 8.1 удалить из `patients/_mocks.ts`: `MOCK_SEGMENTS`, `MOCK_SEGMENTS_TOTAL`, `MOCK_SELECTED_PATIENT`. Оставить `MOCK_AI_RECOS` — это для AI panel (Phase 3b, не наш скоуп).

### DoD
- `/doctor/patients` сегментация показывает реальные группы для пациентов этого врача.
- 0 → пустой donut + текст «Пока нет пациентов».
- `grep MOCK_SEGMENTS src/app/[locale]/doctor/` → пусто.

---

## Фаза 9 — Reception/Visits — мёртвые кнопки (~1 час)

### 9.1 Reception visits-timeline scroll

`/Users/joe/Desktop/medbook/medbook-uz/src/app/[locale]/doctor/reception/_components/visits-timeline.tsx`:
- Кнопки `←`/`→` (line 17 и 62 по аудиту) — повесить `onClick` с `scrollerRef.current?.scrollBy({ left: ±320, behavior: "smooth" })`.
- `useRef<HTMLDivElement>` на горизонтальный скроллер.
- Disable кнопки когда `scrollLeft <= 0` (для левой) или `scrollLeft + clientWidth >= scrollWidth` (для правой). Слушать `scroll` event для пересчёта.
- aria-labels уже есть («Прокрутить влево/вправо»).

### 9.2 Visits list «⋮» dropdown

`/Users/joe/Desktop/medbook/medbook-uz/src/app/[locale]/doctor/visits/[patientId]/_components/visits-list.tsx:426`:
- Завернуть `<MoreVerticalIcon>` в `<DropdownMenu>` (shadcn, уже подключён).
- Items:
  - **«Открыть»** → `router.push("/" + locale + "/doctor/visits/" + patientId + "/" + visit.id)` (уже работает в Phase 4 — дублируем для удобства)
  - **«Копировать ID визита»** → `navigator.clipboard.writeText(visit.id)` + toast
  - **«Открыть карту пациента»** → `/doctor/patients/{patientId}` (уже работает)
  - **«Печать заключения»** — только если у визита есть `visitNote.id`: → `window.open("/api/crm/visit-notes/" + visitNoteId + "/print", "_blank")` (эндпоинт уже есть)

### DoD
- Скролл стрелки реально скроллят; не активны на краях.
- «⋮» в каждой строке визита открывает меню; все 4 пункта работают.

---

## Фаза 10 — Справочники (`/doctor/references`) (~2-3 часа)

### Что делаем
Браузер МКБ-10 справочника (160 кодов в `src/server/icd10/data.ts`, эндпоинт `/api/crm/icd10/search` уже есть). Используется и в reception (autocomplete), и тут — отдельная страница для просмотра/быстрого копирования.

### UI (`/doctor/references/page.tsx`)

**Шапка:** «Справочник МКБ-10» + поиск (input с lucide `SearchIcon`).

**Без поиска (default view):**
- Группировка по главам МКБ-10 (буквы кодов). Разворачиваемые секции:
  - A00–B99 — Инфекционные и паразитарные болезни
  - C00–D48 — Новообразования
  - D50–D89 — Болезни крови
  - E00–E90 — Эндокринные
  - F00–F99 — Психические
  - G00–G99 — Нервная система
  - H00–H59 — Глаз
  - … (всего ~22 главы; список захардкодить локально, RU-метки)
- Под каждой главой — кнопка «развернуть» + список кодов: `<button>` с code (моноширинный, 60px) + nameRu + кнопка-копия справа.

**С поиском (≥2 символа):**
- Дебаунс 200мс → `GET /api/crm/icd10/search?q=...&limit=50`.
- Результаты flat-списком, подсветка матча (можно простым `dangerouslySetInnerHTML` на отрендеренный `<mark>` — или просто bold).
- При пустом результате — empty-state «Ничего не найдено».

**Click на строку:** копирует `{code} — {nameRu}` в буфер + toast «Скопировано». Опционально — открывать модалку с детализацией если данных больше (можно добавить позже когда расширим `Icd10Entry`).

### Hook
`src/app/[locale]/doctor/references/_hooks/use-icd10-search.ts`:
```ts
function useIcd10Search(q: string) {
  return useQuery({
    queryKey: ["doctor","me","icd10","search", q],
    queryFn: () => fetch(`/api/crm/icd10/search?q=${encodeURIComponent(q)}&limit=50`).then(r => r.json()),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });
}
```

(SSE не нужно — справочник статический.)

### DoD
- `/doctor/references` показывает 22 главы со всеми 160 кодами.
- Поиск работает type-ahead.
- Click копирует в буфер.
- `grep PlaceholderPage src/app/[locale]/doctor/references/` → пусто.

### Out of scope для v1
- Загрузка полного МКБ-10 (~14k кодов) — отложено, согласовано в _ROADMAP.md.
- Справочник лек-средств, allergens, синонимы — отдельная фаза.

---

## Фаза 11 — Настройки (`/doctor/settings`) (~6-8 часов, самая крупная)

### 11.0 Скоуп
Профиль + предпочтения уведомлений + ссылка на безопасность. NOT включаем 2FA-флоу здесь — он живёт в `/crm/me/security` (см. additional working directories), вместо реализации — линк туда.

### 11.1 Структура страницы

Tabs (URL-driven `?tab=`):
1. **Профиль** (default) — личные данные врача
2. **Подпись** — загрузка изображения подписи (для PDF-заключений)
3. **Уведомления** — каналы и события
4. **Безопасность** — линк на `/crm/me/security` (пароль, 2FA, sessions). Не дублируем UI.

### 11.2 Профиль (tab=profile)

**Поля редактируемые:**
- Аватар (upload в MinIO через presigned PUT — переиспользовать `/api/crm/documents/upload-url` или новый `/api/crm/doctors/me/avatar`)
- Имя/Фамилия/Отчество (split — `User.firstName`, `lastName`, `middleName` — проверить какие поля есть)
- Телефон, email — readonly если они auth-source-of-truth; иначе editable
- Специализация (combobox из `Speciality` модели если есть; иначе свободный текст)
- Опыт (years, integer)
- Лицензия (license number, free text)
- Bio (textarea, 500 chars)

**Endpoint:** **`PATCH /api/crm/doctors/me/profile`** (новый, проверить что есть `/profile` нет — только видел `summary`/`labs`/`patients` под `/me/`).

```ts
// Request
type ProfilePatch = Partial<{
  firstName: string; lastName: string; middleName: string;
  phone: string; email: string;
  specialty: string; experienceYears: number;
  licenseNumber: string; bio: string;
  avatarUrl: string | null;
}>;
```

`GET /api/crm/doctors/me/profile` — тот же payload + readonly fields (clinicId, role, createdAt).

**Audit:** `DOCTOR_PROFILE_UPDATED`.

### 11.3 Подпись (tab=signature)

**Что:** doctor's wet-signature image, используется в PDF-печати заключений (см. эндпоинт `/api/crm/visit-notes/[id]/print` существует).

**UI:** drop-zone для PNG/JPG (max 1MB, рекомендуем прозрачный PNG). Preview справа. Кнопка «Удалить подпись».

**Endpoint:** `PUT /api/crm/doctors/me/signature` (multipart или presigned PUT → patch). Поле в БД — добавить миграцией: **`Doctor.signatureUrl String?`** (или `User.signatureUrl` если структура другая — проверить при имплементации).

**Audit:** `DOCTOR_SIGNATURE_SET`, `DOCTOR_SIGNATURE_REMOVED`.

### 11.4 Предпочтения уведомлений (tab=notifications)

**Что:** какие события приходят по каким каналам (in-app, email, SMS, Telegram).

**Новая таблица:**
```prisma
model DoctorNotificationPref {
  id          String   @id @default(cuid())
  userId      String   @unique  // FK на User (doctor)
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  // События × каналы. Каждое поле — bitmask или bool-набор; для простоты —
  // отдельные булки на канал, JSON-таблица в коде.
  appointmentCreated_inApp     Boolean @default(true)
  appointmentCreated_email     Boolean @default(false)
  appointmentCreated_telegram  Boolean @default(true)

  messageNew_inApp             Boolean @default(true)
  messageNew_email             Boolean @default(false)
  messageNew_telegram          Boolean @default(true)

  labResultReceived_inApp      Boolean @default(true)
  labResultReceived_email      Boolean @default(true)
  labResultReceived_telegram   Boolean @default(false)

  reminderDue_inApp            Boolean @default(true)
  reminderDue_email            Boolean @default(false)
  reminderDue_telegram         Boolean @default(true)

  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())
}
```

(Альтернатива: один JSONB столбец `prefs Json` — проще миграция, но дороже валидировать. Берём первый вариант — Postgres-native, type-safe.)

**Endpoints:**
- `GET /api/crm/doctors/me/notification-prefs` → весь объект (создаёт дефолтный если нет)
- `PATCH /api/crm/doctors/me/notification-prefs` → partial update

**UI:** таблица: строки — события (Новый приём / Новое сообщение / Результат анализа / Напоминание), столбцы — каналы (In-app / Email / Telegram / SMS — последний скрыть пока не подключим). Toggle в каждой ячейке. Сохранение мгновенное (per-cell PATCH, без кнопки «Сохранить»).

**Кеш-применение:** при отправке уведомлений в воркерах — читать prefs (с кешем 30 сек) и пропускать каналы, которые off.

**Audit:** `DOCTOR_NOTIFICATION_PREFS_UPDATED`.

### 11.5 Безопасность (tab=security)

Просто `<Link href="/${locale}/crm/me/security">Перейти в настройки безопасности</Link>` + чек-лист статуса:
- Пароль установлен — да/нет (читать из `User.passwordHash != null`)
- 2FA включена — да/нет (читать из `User.twoFactorEnabled` или эквивалент)
- Активных сессий — N (читать count из `Session` модели)

Endpoint: `GET /api/crm/doctors/me/security-summary` → краткий статус без чувствительных данных.

### DoD
- 4 таба работают, URL синхронен.
- Профиль: открыл, поправил, обновилось в sidebar (avatar+name).
- Подпись: загрузил → попадает в PDF-печать заключения (smoke-test через `/api/crm/visit-notes/[id]/print` после изменения).
- Уведомления: выключил «Новое сообщение → Telegram» → tg-воркер не шлёт (intеgration-тест).
- Security tab: 3 чека отображаются корректно.
- Audit на каждую мутацию.

---

## Фаза 12 — Cleanup placeholder-страниц (~1-2 часа)

Решение по оставшимся 5 placeholder в sidebar:

| Route | Что делать | Обоснование |
|---|---|---|
| `/doctor/analytics` | **Редирект** → `/${locale}/crm/analytics` (server-side redirect) | Аналитика клиники общая, не doctor-scoped. Дублировать UI смысла нет. |
| `/doctor/reports` | **Редирект** → `/${locale}/crm/analytics` (тот же раздел) | Reports = вкладка аналитики |
| `/doctor/call-center` | **Убрать из sidebar** (не редирект, скрыть пункт меню для роли DOCTOR) | Call-center — функция оператора, не врача. |
| `/doctor/telegram` | **Убрать из sidebar** | Telegram-сообщения видны в `/doctor/messages` (там уже channel=TELEGRAM). Отдельный экран не нужен. |
| `/doctor/templates` | **Убрать из sidebar** | Шаблоны заключений / писем — нужны, но Phase 11+ (отдельный TZ). Пока — скрыть. |

**Implementation:**

1. **Sidebar:** в `doctor-sidebar.tsx:43` (DOCTOR_NAV) удалить items `call-center`, `telegram`, `templates`. Группу «Коммуникации» оставить (там останется `notifications` после Фазы 7). Группу «Аналитика» удалить целиком (после редиректов внутренние страницы вообще не вижны в меню). Группу «Настройки» обрезать до `references` + `settings`.

   **Итоговое меню:**
   - Рабочее пространство (как сейчас)
   - Коммуникации: только «Уведомления» (→ /doctor/notifications)
   - Настройки: «Справочники» + «Настройки»

2. **Редиректы:** заменить `<PlaceholderPage>` в `/doctor/analytics/page.tsx` и `/doctor/reports/page.tsx`:
   ```tsx
   import { redirect } from "next/navigation";
   export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
     const { locale } = await params;
     redirect(`/${locale}/crm/analytics`);
   }
   ```

3. **Удалить** директории `/doctor/call-center/`, `/doctor/telegram/`, `/doctor/templates/` целиком (включая `page.tsx`). Никаких остатков в навигации → нет ссылок → удаление безопасное.

4. **Удалить** `_components/placeholder-page.tsx` если он больше нигде не используется (`grep "PlaceholderPage" src/`).

### DoD
- В sidebar врача 3 группы, 10 рабочих ссылок, 0 placeholder-страниц.
- `/doctor/analytics` и `/doctor/reports` мгновенно редиректят на CRM.
- Прямой URL на `/doctor/call-center` → 404 (next default), не placeholder.

---

## Глобальные out-of-scope (не делаем в этом TZ)

- **AI Assistant Panel на /doctor/patients** — это Phase 3b из _ROADMAP.md, отдельный спринт.
- **Phase 6 backlog** (lab-system интеграция, reminder автогенерация) — переносится дальше.
- **Шаблоны заключений** — UI для своих шаблонов, requires `NotificationTemplate` extension. Будет в отдельной фазе позднее.
- **Расширение МКБ-10 до full ~14k** — отложено.

---

## Прогресс-чекбокс

- [x] **Фаза 7** — `/doctor/notifications` real reminders UI (закрывает регрессию)
- [x] **Фаза 8** — SegmentationCard на реальных данных + cleanup _mocks
- [x] **Фаза 9** — Reception timeline scroll + Visits «⋮» dropdown
- [x] **Фаза 10** — `/doctor/references` МКБ-10 браузер
- [x] **Фаза 11** — `/doctor/settings` (профиль / подпись / уведомления / линк на security)
- [x] **Фаза 12** — Sidebar cleanup + redirects/удаления 5 placeholder-страниц

Деплой — только по явному приказу. Между фазами стоп в локалке, отчёт + диф.

## Estimated bandwidth

- Фаза 7: 3-4 часа
- Фаза 8: 1.5-2 часа
- Фаза 9: 1 час
- Фаза 10: 2-3 часа
- Фаза 11: 6-8 часов
- Фаза 12: 1-2 часа

**Total: ~15-20 часов** фокусной работы.
