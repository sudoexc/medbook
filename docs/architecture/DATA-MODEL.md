# MedBook / NeuroFax — модель данных (as-is)

Источник истины: `prisma/schema.prisma` (80 моделей, 53 enum) + `prisma/migrations/` (78 миграций, `20260422080121_phase-1-initial` → `20260713120000_action_call_outcome`). Стек: Prisma 7 (`prisma-client` provider, генерация в `src/generated/prisma`), Postgres 16, адаптер `@prisma/adapter-pg`.

Конвенции всей схемы:
- Каждая операционная модель несёт `clinicId` + FK на `Clinic`; уникальные ключи внутри клиники — композитные `@@unique([clinicId, ...])`.
- Деньги — `Int` в минорных единицах (тийины для UZS, центы для USD); `Invoice.amountTiins` — `BigInt`.
- Многие «маленькие» статусы — `String`, а не enum (комментарии в схеме: «forward-compat без миграции»): `Action.status/severity`, `Prescription.status`, `PatientAllergy.severity`, `MedicationReminderSend.status`, `Campaign.status`, `PatientFamily.relationship` и др.

## Оглавление

1. [Мульти-тенантность](#1-мульти-тенантность)
2. [Карта моделей по доменам](#2-карта-моделей-по-доменам)
3. [Ключевые модели детально](#3-ключевые-модели-детально)
4. [Медико-правовые гарантии на уровне БД](#4-медико-правовые-гарантии-на-уровне-бд)
5. [Миграции](#5-миграции)
6. [Сиды](#6-сиды)

---

## 1. Мульти-тенантность

### Механизм

Изоляция клиник — **application-level**, без Postgres RLS. Три файла:

| Файл | Роль |
|---|---|
| `src/lib/tenant-context.ts` | `TenantContext` в `AsyncLocalStorage`; `runWithTenant(ctx, fn)`, `getTenant()`, `requireTenant()`, `getClinicId()`, `getBranchId()` |
| `src/lib/prisma.ts` | `prismaBase.$extends({ name: "tenantScope" })` — query-хук `$allModels.$allOperations`, автоинъекция `clinicId` |
| `src/lib/tenant-allowlist.ts` | Политики: `MODELS_WITHOUT_TENANT`, `MODELS_TENANT_BYPASSABLE`, `MODELS_BRANCH_SCOPED`, `COMPOSITE_TENANT_UNIQUES`, списки операций |

Виды контекста (`TenantContext`):

| Kind | Поведение расширения |
|---|---|
| `TENANT` (`clinicId`, `userId`, `role`, `branchId?`, `impersonation?`) | Инъекция `clinicId` в `where` (reads + update/delete/upsert по фильтру) и в `data` (create/createMany/createManyAndReturn). `upsert` дополнительно скоупит `create`-payload |
| `SUPER_ADMIN` (`userId`) | Инъекции нет — хэндлеры `/admin` фильтруют клиники вручную |
| `SYSTEM` | Инъекции нет — cron, воркеры, онбординг-сиды |
| **нет контекста** | **Инъекции нет — запрос уходит как есть (pass-through)** |

⚠️ **Что происходит, если забыть контекст:** расширение при `getTenant() === undefined` просто пропускает запрос без скоупинга («Callers that need isolation must wrap their invocation with runWithTenant»). То есть забытый `runWithTenant` = потенциальная кросс-тенантная утечка, а не ошибка. Защита от этого — на уровне API-обёртки: `createApiHandler` (`src/lib/api-handler.ts`) сам строит контекст из сессии и вызывает `runWithTenant(ctx, () => handler(...))`, поэтому весь код внутри стандартных роутов скоупится автоматически. `requireTenant()` кидает Error со `status = 403`, если контекста нет.

Детали инъекции:
- Если `where` уже содержит `clinicId` **или** композитный уникальный ключ из `COMPOSITE_TENANT_UNIQUES` (`Patient.clinicId_phoneNormalized`, `Doctor.clinicId_slug`, `Service.clinicId_code`, `Cabinet.clinicId_number`, `NotificationTemplate.clinicId_key`, `ExchangeRate.clinicId_date`, `ProviderConnection.clinicId_kind_label`, `Conversation.clinicId_externalId`, `Message.clinicId_externalId`, `Call.clinicId_sipCallId`, `Branch.clinicId_slug`, `DocumentCounter.clinicId_year_kind`) — вторая инъекция не делается (Prisma отверг бы дубль колонки).
- `{ skipTenantScope: true }` в аргументах запроса — точечный обход скоупа изнутри TENANT-контекста, разрешён **только** для `MODELS_TENANT_BYPASSABLE` = `ExchangeRate`, `ProviderConnection` (FX-синк, провайдеры). Флаг вырезается до передачи в Prisma.
- Raw-операции (`$queryRaw` и т.п.) расширением не скоупятся — аналитика ходит в materialized views через `$queryRawUnsafe` с параметризованным `clinicId` (комментарий в схеме, секция Phase 18).

### Нетенантные (платформенные) модели

`MODELS_WITHOUT_TENANT` — расширение их не трогает:

- **Совсем без `clinicId`:** `Clinic`, `User` (у SUPER_ADMIN `clinicId = null`), `Account`, `Session`, `VerificationToken`, `ServiceOnDoctor`, `DoctorNotificationPref`, `DoctorFavorite`, `Plan`, `ClinicSignupToken`, `LabTest`, `LabPanel`, `LabPanelTest`.
- **`clinicId` есть, но nullable + кросс-тенантный по дизайну** (глобальный каталог `clinicId = null` + клиничные оверрайды; роуты фильтруют `clinicId IN (null, ctx.clinicId)` вручную): `DiagnosisGuide`, `Drug`, `DrugInteraction`, `DrugBrand`, `ClinicalProtocol`, `HandoutTemplate`.
- **`AuditLog`** — имеет `clinicId?`, но намеренно исключён из скоупинга, чтобы системные действия писались в любом контексте (комментарий в схеме).

Отдельно вне allowlist, но фактически платформенные (доступ только из SYSTEM/SUPER_ADMIN контекстов, где инъекции нет): `ImpersonationGrant`, `EventOutbox` (несёт `clinicId`, но пишется воркерами). `ClinicSignupToken` и `ImpersonationGrant` **намеренно без FK** на Clinic/User — строка должна пережить удаление клиники (аудит/форензика).

### Филиалы (Branch)

`Branch` есть (Phase 9a): `@@unique([clinicId, slug])`, дефолтный филиал `slug='hq', isDefault=true` создан бэкфилл-миграцией. Скоупинг — **второй слой поверх clinicId**: если TENANT-контекст несёт `branchId`, расширение дополнительно фильтрует `branchId = ctx.branchId`, но только для `MODELS_BRANCH_SCOPED` = `Doctor`, `Cabinet`, `Appointment`, `DoctorSchedule`, `DoctorTimeOff`. Все прочие модели (Patient, Payment, Document, Conversation…) остаются clinic-wide всегда. Без `branchId` в контексте поведение — историческое clinic-wide. `branchId` на этих моделях **nullable** (комментарий в схеме: «Phase 9b tightens to NOT NULL» — ⚠️ по факту до сих пор nullable). Сам `Branch` в branch-scoped набор не входит.

---

## 2. Карта моделей по доменам

Все 80 моделей схемы.

### Платформа / тенант / SaaS

| Модель | Назначение |
|---|---|
| `Clinic` | Корень тенанта: бренд, TZ/валюта, рабочий день, TG-бот, флаги (2FA, idle timeout, NPS-порог, referral %), `patientCounter`, `customSubdomain`, letterhead/`documentNumberPrefix` |
| `Branch` | Филиал клиники (`hq` — дефолт); второй слой скоупинга для 5 моделей |
| `Plan` | Каталог SaaS-тарифов (basic/pro/enterprise), feature-гейты в `features Json` |
| `Subscription` | 1:1 с клиникой (`clinicId @unique`), TRIAL/ACTIVE/PAST_DUE/CANCELLED, `pendingPlanId` для апгрейда до оплаты |
| `Invoice` | Счёт за период подписки; `amountTiins BigInt`, `number @unique`, `targetPlanId` фиксирует план на момент выставления |
| `ClinicSignupToken` | Self-service signup: токен из письма → провижининг Clinic+ADMIN+TRIAL; без FK (переживает клинику) |
| `ImpersonationGrant` | Грант SUPER_ADMIN «войти в клинику»: reason, `mode` WRITE/VIEW_ONLY, lease c `expiresAt`; без FK |
| `ExchangeRate` | Курс UZS→USD по дням на клинику (`@@unique([clinicId, date])`); tenant-bypassable |
| `ProviderConnection` | Шифрованные креды провайдеров (TG/SMS/Payme/Click/Uzum/OpenAI) — `secretCipher`; tenant-bypassable |

### Auth / персонал

| Модель | Назначение |
|---|---|
| `User` | Сотрудник (роли `Role`: SUPER_ADMIN/ADMIN/DOCTOR/RECEPTIONIST/NURSE/CALL_OPERATOR); `email @unique` глобально; TOTP-поля, `preferredLocale`, `mustChangePassword` |
| `Account`, `Session`, `VerificationToken` | Стандартные таблицы NextAuth |
| `UserSession` | Собственная сессионная таблица (Phase 17 W2): `tokenHash @unique`, idle timeout, «1 активная сессия на юзера» |
| `Doctor` | Профиль врача (может быть без User): slug, RU/UZ имена/специализация, `salaryPercent`, `maxBookableSlotsPerDay`, **`cabinetId @unique NOT NULL` (Restrict)**, `signatureUrl`, `tvToken @unique` |
| `DoctorSchedule` | Недельная сетка врача (weekday + start/end, validFrom/To); branch-scoped |
| `DoctorTimeOff` | Отпуска/отгулы врача (интервал startAt–endAt); branch-scoped |
| `DoctorPreset` | Чипы-пресеты врача для структурных полей VisitNote (`field: DoctorPresetField`) + `noteTemplate` в markdown |
| `DoctorNotificationPref` | Матрица уведомлений врача 4 события × 3 канала (inApp/email/telegram), 1:1 с User |
| `DoctorFavorite` | «★» врача на элемент каталога (`entityType: CatalogEntityType`, `entityCode`) |

### Справочники / клиническая база знаний (кросс-тенантные)

| Модель | Назначение |
|---|---|
| `Drug` | Глобальный каталог лекарств (МНН, `inn @unique`, ATC, `forms Json`, показания/противопоказания, `pregnancyCat`, `rxOnly`); `clinicId?` для клиничных добавлений |
| `DrugBrand` | Бренд → препарат («Конкор» → bisoprolol) |
| `DrugInteraction` | Реестр межлекарственных взаимодействий (`@@unique([drugAId, drugBId])`, severity MINOR…CONTRAINDICATED) для CDS |
| `ClinicalProtocol` | «Стандарт лечения» по ICD-10 префиксу: шаблоны жалоб/анамнеза/осмотра, `prescriptionItems Json`, рекомендованные lab-коды; 3 скоупа: global/clinic/doctor |
| `DiagnosisGuide` | База знаний по диагнозу (longest `matchPrefix` ICD-10): patient-facing блоки RU/UZ, advice-чипы, `defaultFollowUpDays` |
| `HandoutTemplate` | Библиотека памяток пациенту (Markdown RU/UZ, `matchPrefixes` по ICD-10) |
| `ClinicCatalogOverlay` | Клиника скрывает глобальную запись каталога (`hideGlobal`); `overridesJson` зарезервирован |
| `LabTest` | Каталог анализов (`code @unique`, биоматериал, `refRanges Json`, TAT, цена) |
| `LabPanel` | Именованный набор анализов («Биохимия базовая») |
| `LabPanelTest` | Join-таблица panel↔test (`@@id([panelId, testId])`) |
| `Service` | Услуга клиники (`@@unique([clinicId, code])`, `priceBase`, `durationMin`, `freeRepeatDays` для бесплатного повтора в рамках кейса) — тенантная |
| `ServiceOnDoctor` | Join врач↔услуга с `priceOverride`/`durationMinOverride`; без clinicId |
| `Cabinet` | Кабинет (`@@unique([clinicId, number])`); 1:1 с Doctor через `Doctor.cabinetId`; branch-scoped |

### Пациенты

| Модель | Назначение |
|---|---|
| `Patient` | Карточка пациента — см. [§3](#patient) |
| `PatientAllergy` | Аллергия (substance, reaction, severity-строка MILD/MODERATE/SEVERE) |
| `PatientChronicCondition` | Хроническое заболевание (name, sinceDate, isActive) |
| `PatientDiagnosis` | Персистентный диагноз на карточке (icd10Code free-text, status ACTIVE/RESOLVED) |
| `PatientFamily` | Семейная связь: TG-владелец действует за linked-пациента; self-link запрещён CHECK-констрейнтом в БД |
| `PatientReview` | NPS-ответ 1..10 из Mini App/бота (CHECK 1..10 в БД); не путать с `Review` |
| `Review` | Публичные отзывы (Яндекс/Google) для витрины клиники |
| `PatientView` | Аудит доступа к PHI: кто/когда/в каком контексте открыл карточку (дедуп 5 мин на app-уровне) |
| `ReferralCode` | «Приведи друга» — share-токен пациента (`code @unique` глобально) |
| `ReferralReward` | Начисленная скидка рефереру; `@@unique([referrerPatientId, referredPatientId])` против двойного кредита |
| `TelegramInviteToken` | Короткоживущий deep-link `t.me/<bot>?start=<token>` для привязки TG к пациенту |

### Расписание и приём

| Модель | Назначение |
|---|---|
| `Appointment` | Запись/визит — см. [§3](#appointment) |
| `AppointmentService` | Доп. услуги визита (`@@id([appointmentId, serviceId])`, `priceSnap` — снапшот цены) |
| `MedicalCase` | Эпизод лечения, группирует 1..N визитов (status OPEN/RESOLVED/ABANDONED/TRANSFERRED, `soapDraft` для voice→SOAP) |
| `EmptySlotSnapshot` | Аналитика упущенной выручки: строка на (врач, дата, час) пустого слота, сумма в тийинах |

### Клинические записи

| Модель | Назначение |
|---|---|
| `VisitNote` | Заключение врача по визиту, 1:1 с Appointment — см. [§3](#visitnote) |
| `VisitPrescription` | Структурное назначение внутри VisitNote (drugId?, снапшот `displayName`, дозировка, `timesOfDay`, `mealRelation`, `remindPatient`) |
| `Prescription` | Курс приёма для напоминаний пациенту (Mini App); привязан к MedicalCase **или** мостом из VisitNote (`@@unique([visitNoteId, visitNoteSortOrder])` — идемпотентный бридж) |
| `EPrescription` | Э-рецепт: `rxNumber @unique`, `verifyToken @unique` (QR), снапшоты диагноза/подписи, `items Json`, `validUntilAt` |
| `SickLeave` | Больничный: `certNumber @unique`, `verifyToken @unique`, режим OUTPATIENT/HOSPITAL/HOME, период `@db.Date` |
| `Referral` | Направление к коллеге (`toDoctorId`) или наружу (`externalTo`); снапшот диагноза; статусы PENDING/SCHEDULED/COMPLETED/CANCELLED |
| `LabOrder` | Заказ анализов из визита: `orderNumber @unique`, снапшоты `testCodes[]`/`panelCodes[]`, urgency ROUTINE/URGENT/STAT |
| `LabResult` | Результат анализа (MVP, плоская строка: testName, value-строка, flag NORMAL/LOW/HIGH/CRITICAL, status PENDING/RESULTED/REVIEWED/ARCHIVED) |
| `CdsOverride` | Аудит-строка «врач осознанно проигнорировал CDS-предупреждение»: снапшот warning + `reason: CdsOverrideReason` |
| `Reminder` | Личная задача врача («позвонить Касымову»), remindAt, статусы PENDING/DONE/DISMISSED/SNOOZED |

*Примечание: `Reminder.doctorId`, `LabResult.doctorId`, `LabOrder.doctorId`, `Referral.fromDoctorId/toDoctorId`, `EPrescription.doctorId`, `SickLeave.doctorId`, `CdsOverride.doctorId` указывают на **User**, а не Doctor (гейт «is this the assigned user?»); `VisitNote.doctorId` и `Prescription.doctorId` — на **Doctor**.*

### Документы

| Модель | Назначение |
|---|---|
| `Document` | Файл в MinIO + метаданные — см. [§3](#document) |
| `DocumentCounter` | Пер-клиника/год/kind монотонный счётчик номеров («NF-2026-000123»); `@@unique([clinicId, year, kind])`, аллокация `createMany(skipDuplicates)` + атомарный инкремент |

### Коммуникации

| Модель | Назначение |
|---|---|
| `Conversation` | Тред чата (TG-инбокс): mode bot/takeover, `@@unique([clinicId, externalId])`, unreadCount, snooze |
| `Message` | Сообщение треда (direction IN/OUT, attachments/buttons Json, `@@unique([clinicId, externalId])`) |
| `Communication` | Лёгкий аудит-трейл всех касаний (канал × направление); чаты живут не тут |
| `CannedResponse` | Быстрые ответы для композера TG-инбокса (RU/UZ) |
| `NotificationTemplate` | Шаблон уведомления (`@@unique([clinicId, key])`, канал, категория, RU/UZ тела, `trigger: NotificationTrigger`) |
| `NotificationSend` | Отправка уведомления; статусы QUEUED→**SENDING**(claim)→SENT/DELIVERED/READ/FAILED/CANCELLED |
| `MedicationReminderSend` | Напоминание о приёме лекарства; `@@unique([prescriptionId, scheduledFor])` — дедуп тиков воркера |
| `Campaign` | Рассылка по сегменту (`segment Json`, счётчики total/sent/failed) |
| `Call` | Звонок колл-центра (направление, статус, SIP `@@unique([clinicId, sipCallId])`, запись, длительность) |
| `Lead` | Лид с форм → конвертируется в Appointment (`Appointment.leadId @unique`); `referrerPatientId` для рефералки |
| `OnlineRequest` | Онлайн-заявка с сайта/киоска (имя+телефон+utm), статусы LeadStatus |

### Деньги

| Модель | Назначение |
|---|---|
| `Payment` | Платёж пациента: minor units, метод CASH/CARD/TRANSFER/PAYME/CLICK/UZUM, `amountUsdSnap`+`fxRate`, `@@unique([clinicId, idempotencyKey])` |
| `Invoice` | SaaS-счёт клинике (см. Платформа) |

### Служебное / аудит / фоновые задания

| Модель | Назначение |
|---|---|
| `Action` | Action Center — см. [§3](#action) |
| `AuditLog` | Журнал действий (actor, action, entityType/Id, meta, ip); вне тенант-скоупа; `eventId @unique` — линк на EventOutbox |
| `EventOutbox` | Durable WAL realtime-событий: PENDING→DELIVERED/FAILED/DEAD, `envelope Json` (EventEnvelope v2), at-least-once для SSE + replay по `Last-Event-ID` |
| `DataExportJob` | DSAR-экспорт: ZIP с AES-паролем (хранится только `passphraseHash`), доставка через TG, `expiresAt` 30 дней |
| `DataDeletionJob` | DSAR-удаление: ANONYMIZE (дефолт) / HARD_DELETE, cooling-off 90 дней (`scheduledFor`), статусы PENDING_REVIEW→APPROVED→EXECUTED/ANONYMIZED |
| `LLMUsage` | Строка на каждый LLM-вызов: useCase-slug, токены, `costUzs` (тийины), `promptHash` (sha256 редактированного промпта), errorCode |
| `SavedReport` | Сохранённая конфигурация report-builder (`config Json` — opaque) |
| `ScheduledReport` | Расписание доставки отчёта (cadence, `nextRunAt`, канал EMAIL/TELEGRAM, автоотключение после 3 фейлов) |

---

## 3. Ключевые модели детально

### Patient

1:N от Clinic; уникальность: **`@@unique([clinicId, phoneNormalized])`** (телефон — идентичность пациента внутри клиники, дубль-регистрация невозможна) и **`@@unique([clinicId, patientNumber])`** (человекочитаемый номер «P-00125», аллокация атомарным `UPDATE … RETURNING` на `Clinic.patientCounter`).

| Поле | Тип | Смысл |
|---|---|---|
| `patientNumber` | `Int` | Пер-клиника последовательность 1,2,3… |
| `fullName`, `phone`, `phoneNormalized` | `String` | ФИО и телефон (нормализованный — ключ уникальности) |
| `birthDate`, `gender`, `passport`, `address` | `DateTime?`/`Gender?`/`String?` | Демография (Gender: MALE/FEMALE) |
| `telegramId`, `telegramUsername`, `telegramLinkedAt`, `tgBlockedAt` | — | Привязка TG; `tgBlockedAt` — пациент заблокировал бота (исключается из рассылок) |
| `preferredChannel` | `CommunicationChannel` | SMS/TG/CALL/EMAIL/VISIT/INAPP, дефолт TG |
| `preferredLang` | `Lang` | RU/UZ |
| `segment` | `PatientSegment` | NEW/ACTIVE/DORMANT/VIP/CHURN |
| `source` | `LeadSource?` | WEBSITE/TELEGRAM/INSTAGRAM/CALL/WALKIN/REFERRAL/ADS/OTHER |
| `ltv`, `visitsCount`, `balance`, `discountPct` | `Int` | Денормализованные агрегаты (деньги — минорные единицы) |
| `lastVisitAt`, `nextVisitAt`, `lastContactedAt` | `DateTime?` | `lastContactedAt` — только операторские касания, автошаблоны не считаются |
| `dormantSince`, `reactivationSentAt` | `DateTime?`, `DateTime[]` | Реактивация: массив таймстемпов вместо join-таблицы (идемпотентность «раз в квартал») |
| `summaryCache`, `summaryCacheUpdatedAt` | `String?`, `DateTime?` | LLM-резюме карточки |
| `consentMarketing` / `marketingOptOut`(+`At`,+`Source`) | `Boolean` | Opt-in ≠ opt-out: `marketingOptOut=true` блокирует маркетинговые пуши, транзакционные — никогда |
| `deletedAt`, `deletionRequestedAt`, `deletionReason` | — | Soft-delete / DSAR-плёмбинг |

Ходовые индексы: `[clinicId, fullName]`, `[clinicId, segment]`, `[clinicId, lastVisitAt]`, `[clinicId, lastContactedAt]`, `[clinicId, createdAt]`, `[clinicId, telegramId]`.

### Appointment

Центральная модель. Связи: Clinic, Branch?, Patient, Doctor, Cabinet?, `serviceId?` (primary service денормализован; остальные — в `AppointmentService`), `medicalCaseId?` (SetNull), `leadId? @unique`, `confirmedByUser?`. Обратные 1:1/1:N: `visitNote?`, `conversation?`, documents, payments, labOrders/labResults, eprescriptions, sickLeaves, reminders, cdsOverrides, scheduledReferrals.

**Статусы** (`AppointmentStatus`, используется двумя полями — `status` и `queueStatus`):
`BOOKED → CONFIRMED → WAITING → IN_PROGRESS → COMPLETED`, ветки `SKIPPED`, `CANCELLED`, `NO_SHOW`.

**Канал** (`ChannelType`): `WALKIN | PHONE | TELEGRAM | WEBSITE | KIOSK`. Дефолт WALKIN. Модель «двух полос» (docs/TZ-two-lanes.md): WALKIN — живая очередь по порядку прихода, остальные каналы — календарные слоты.

**Поля живой очереди:**

| Поле | Тип | Смысл |
|---|---|---|
| `queueOrder` | `Int?` | Порядок в очереди, мутируется drag-reorder ресепшена |
| `ticketSeq` | `Int?` | **Иммутабельный** номер талона, замораживается при входе в очередь — reorder не переименовывает напечатанный талон (единственный вход `ticketNumberFor`) |
| `ticketCode` | `String? @unique` | Глобально-уникальный короткий код (Crockford base32, 6 симв.) для QR пациента |
| `queuePriority` | `Int @default(0)` | Ручной буст «срочно»; тай-брейк — `queueOrder` |
| `queuedAt` | `DateTime?` | serveAt-якорь EDF: момент входа в WAITING. Walk-in обслуживаются FIFO по нему, запись по времени — `max(slot, queuedAt)`; SKIPPED при возврате получает свежий stamp, IN_PROGRESS→WAITING сохраняет старый |
| `arrivedAt` | `DateTime?` | «Я на месте» из Mini App — не смена статуса, интейк остаётся за ресепшеном |

**Таймстемпы жизненного цикла:** `calledAt` (вызван на табло) → `startedAt` (начат приём) → `completedAt`; плюс `cancelledAt`/`cancelReason`/`cancelledBy` (строка "patient"|"staff"|"system"|"no-show") и трио подтверждения `confirmedAt`/`confirmedBy`/`confirmedVia` (`ConfirmationVia`: BOOKING_AUTO / MANUAL_CRM / SMS_REPLY / TG_BUTTON / INBOUND_CALL; `confirmedBy` null для не-стаффовых способов).

**Слот-уникальность — не Prisma, а raw-SQL EXCLUDE-констрейнты** (миграции `20260429_appointment_no_overlap` + `20260627120000_appointment_walkin_overlap_exempt`, расширение `btree_gist`):

```sql
Appointment_doctor_no_overlap:  EXCLUDE USING gist (doctorId WITH =, tsrange(date, endDate, '[)') WITH &&)
  WHERE (status NOT IN ('CANCELLED','NO_SHOW') AND channel <> 'WALKIN')
Appointment_cabinet_no_overlap: то же по cabinetId (+ cabinetId IS NOT NULL)
```

Гарантия: два календарных визита одного врача/кабинета не могут пересечься по времени даже мимо app-кода (сиды, raw SQL). WALKIN-строки **исключены** (их окно `[now, now+30)` — просто ETA, не резерв слота); CANCELLED/NO_SHOW освобождают слот. Полуинтервал `[)` — стык 12:00–12:30/12:30–13:00 не конфликт. В Prisma-схеме этих констрейнтов не видно — только в миграциях.

Pre-visit/NPS: `preVisitData Json` / `preVisitNotifiedAt` / `preVisitSubmittedAt`, `npsRequestedAt` — дедуп-штампы воркеров. Цены: `priceService/priceBase/discountPct/discountAmount/priceFinal`.

### VisitNote

1:1 с Appointment (**`appointmentId @unique`**), финализация парная с `Appointment.status → COMPLETED`.

| Поле | Тип | Смысл |
|---|---|---|
| `status` | `VisitNoteStatus` | `DRAFT` (автосейв во время приёма) → `FINALIZED` («Завершить приём»); после — read-only, короткое пост-визитное окно правок логируется в аудит |
| `startedAt`, `finalizedAt` | `DateTime?` | Таймстемпы жизненного цикла |
| `documentNumber` | `String?` | «NF-2026-000123», аллокация атомарно в транзакции финализации через `DocumentCounter`; копируется в `Document.number` воркером |
| `complaints`, `anamnesis`, `examination`, `prescriptions`, `advice` | `String[]` | Структурные поля-чипы (`prescriptions[]` — legacy read-only, актуальные назначения в `visitPrescriptions`) |
| `diagnosisCode`, `diagnosisName` | `String?` | ICD-10 плоскими колонками (без FK на справочник — намеренно); name — денормализованная копия для отображения |
| `followUpDays`, `followUpNote` | `Int?`, `String?` | План повторного визита: печатается в заключении, нюдж в Mini App, Action ресепшену |
| `medicationsBridgedAt` | `DateTime?` | null = finalize-воркер ещё не отзеркалил `remindPatient`-строки в `Prescription` |
| `dynamics`, `dynamicsNote` | `String?` | Состояние vs прошлый визит: IMPROVED/STABLE/WORSE (строка, не enum) |
| `bodyMap` | `Json?` | Карта тела `[{x, y, view: FRONT|BACK, label?}]`, координаты 0..1 |
| `bodyMarkdown` | `String? @db.Text` | Канонический свободный текст врача |
| `patientHandoutMarkdown` | `String? @db.Text` | Памятка пациенту (без МКБ-кодов), собирается шаблонизатором без LLM |
| `aiGenerated`, `aiModel`, `aiTokens` | — | Провенанс AI-генерации; флаг никогда не сбрасывается правками |

Связи: `visitPrescriptions`, `bridgedPrescriptions` (Prescription), labOrders/labResults, ePrescriptions, sickLeaves, cdsOverrides, referrals, `conclusionDocument` (1:1 через `Document.visitNoteId`). **`patient … onDelete: Restrict`** — см. §4.

### Document

| Поле | Тип | Смысл |
|---|---|---|
| `type` | `DocumentType` | REFERRAL/PRESCRIPTION/RESULT/CONCLUSION/CONSENT/CONTRACT/RECEIPT/OTHER |
| `visitNoteId` | `String? @unique` | Только для авто-CONCLUSION. **Уникальность = идемпотентность воркера**: handout-worker делает upsert по ней, повторный прогон (ретрай sweep, редеплой) не плодит дубль заключения. `onDelete: SetNull` |
| `referralId` | `String? @unique` | То же для авто-REFERRAL PDF — та же гарантия |
| `number` | `String?` | Человекочитаемый номер; для CONCLUSION копия `VisitNote.documentNumber` |
| `verifyToken` | `String? @unique` | Публичная QR-верификация `/v/[token]`: тип/номер/дата, пациент маскируется до инициалов |
| `fileUrl`, `mimeType`, `sizeBytes` | — | Файл в MinIO (приватный бакет, отдача через streaming-proxy) |
| `signedAt` | `DateTime?` | Подпись CONSENT/CONTRACT; NULL = «ожидает подписи» |
| `uploadedById` | `String?` | User-загрузчик |
| `patientId` | `String` | **Restrict** — см. §4 |

### Action

Action Center (Phase 13): атомарная системная рекомендация с deeplink. Детекторы фоново делают upsert по **`@@unique([clinicId, dedupeKey])`** — стабильный ключ вида `EMPTY_SLOT_TOMORROW:doctorId=XYZ:slot=…` гарантирует, что повторные проходы детектора не спамят дубли, а обновляют существующую строку.

| Поле | Тип | Смысл |
|---|---|---|
| `type` | `String` | ActionType-union (`src/lib/actions/types.ts`), не enum |
| `severity` | `String` | 'low'/'medium'/'high'/'critical' |
| `status` | `String @default("OPEN")` | OPEN/SNOOZED/DISMISSED/DONE/EXPIRED |
| `payload` | `Json` | Дискриминированный union `ActionPayload`; деньги внутри — в тийинах |
| `assigneeRole` | `String?` | 'ADMIN'/'RECEPTIONIST', null = любая роль |
| `deeplinkPath`, `snoozeUntil`, `dismissedAt`, `doneAt`, `expiresAt` | — | Жизненный цикл |
| `outcome` | `String?` | Результат риск-звонка: CONFIRMED/RESCHEDULED/CALLBACK/RETURN_LATER/REFUSED/NO_ANSWER; **локирует строку** от 15-мин пересчёта движка до `expiresAt` |
| `outcomeNote`, `callbackAt`, `resolvedById`, `callAttempts` | — | Заметка, время повторного всплытия, кто записал, счётчик недозвонов |

`branchId?` (SetNull) — branch-scoped модель.

---

## 4. Медико-правовые гарантии на уровне БД

`onDelete: Restrict` стоит в трёх местах (все с комментариями в схеме):

| Связь | Зачем |
|---|---|
| `VisitNote.patient → Patient` | «Medico-legal guard (D-5)»: финализированное заключение — юридический документ, обязан пережить строку пациента. БД физически откажет в hard-delete пациента, пока существует хоть один VisitNote |
| `Document.patient → Patient` | То же для подписанных согласий/договоров и conclusion-handout'ов |
| `Doctor.cabinet → Cabinet` | Нельзя удалить кабинет, пока в нём «сидит» врач — сначала переназначение |

Для первых двух Restrict — это и так дефолт Prisma для required-relation, но он **прописан явно**, чтобы будущая правка не могла молча превратить его в Cascade (формулировка из комментариев схемы). Смежный случай: `SavedReport.createdBy` — Restrict, чтобы удаление юзера не стёрло отчёты клиники.

**Связь с DSAR:** из-за Restrict роут DELETE пациента не может (и не должен) делать hard-delete у пациента с историей — такие запросы уводятся в DSAR-поток `DataDeletionJob`: дефолтный режим `ANONYMIZE` скрабит PII с строки Patient, сохраняя агрегаты (LTV, визиты, платежи); `HARD_DELETE` — только когда юридически необходимо. Джоб исполняется hourly-кроном не раньше `scheduledFor` (дефолт +90 дней cooling-off, пациент может отменить из Mini App). Плёмбинг на самой карточке: `Patient.deletedAt` (невидимость для всех рассылок), `deletionRequestedAt`, `deletionReason`.

Прочие заметные политики удаления: почти всё каскадится от `Clinic` (`onDelete: Cascade` — снос тенанта сносит данные); `Appointment.medicalCase`, `Document.visitNote/referral`, `Referral.visitNote/scheduledAppointment`, `Action.branch` — `SetNull` (ребёнок переживает родителя); `ClinicSignupToken` и `ImpersonationGrant` вовсе без FK — переживают клинику для аудита.

Дополнительные DB-уровневые гарантии из миграций (в Prisma-схеме не видны):
- EXCLUDE-констрейнты `Appointment_doctor_no_overlap` / `Appointment_cabinet_no_overlap` (§3).
- `CHECK ("ownerPatientId" <> "linkedPatientId")` на PatientFamily; `CHECK (score >= 1 AND score <= 10)` на PatientReview (`20260506130214_phase16_patient_experience`).
- Materialized views `mv_doctor_performance` / `mv_cohort_retention` / `mv_financial_pace` / `mv_schedule_heatmap` — raw SQL в миграции Phase 18 W1.

---

## 5. Миграции

- 78 директорий в `prisma/migrations/`, применение стандартным `prisma migrate deploy` (не `db push`). Немало миграций — чистый raw SQL (EXCLUDE, CHECK, matviews, backfill'ы), т.е. схема Prisma — не полное описание БД.
- **Прод: миграции гоняются через образ `worker`, а не `app`.** Подтверждено `ops/deploy.sh` (шаг 4):

  ```bash
  docker compose run --rm --no-deps worker npx prisma migrate deploy
  ```

  Причина (комментарий в deploy.sh): app-образ — Next.js **standalone**-бандл (`Dockerfile`, stage runner), он не тянет все транзитивные зависимости Prisma CLI (`@prisma/dev` → `pathe` и др.), и `migrate deploy` там падает. `Dockerfile.worker` копирует **полный** `node_modules` + `src/` + `scripts/` + `prisma/` — поэтому и миграции, и one-shot скрипты (`docker compose exec worker npx tsx scripts/...`) выполняются в worker-контейнере. `compose run --rm --no-deps` (а не `exec`) — чтобы не зависеть от состояния живого worker-контейнера и не трогать lifecycle postgres/redis.
  - ⚠️ Шапка `docker-compose.yml` всё ещё советует `docker compose exec app npx prisma migrate deploy`, а `Dockerfile` app-а копирует prisma CLI «for migrate deploy on startup» — это устаревшие комментарии, реальный пайплайн — worker (deploy.sh — источник истины).
- Порядок деплоя: `git reset --hard origin/main` → `build app worker` → `up -d` → health-wait → `restart nginx` (перечитать upstream IP) → `migrate deploy` (fail не роняет деплой — `||true` с WARN). Итого: миграция применяется **после** переключения трафика на новый код — fix-forward модель (см. `docs/runbook.md`).
- ⚠️ Известный операционный риск (docs/feedback): `docker compose build` может закешировать устаревший слой с `prisma/migrations/` — после деплоя сверять содержимое таблицы `_prisma_migrations`.

## 6. Сиды

Все — в `scripts/` (не в `prisma/seed.ts`; штатный `prisma/seed.ts` сломан на Prisma 7 strict mode — отмечено в заголовке `seed-labs-reminders-dev.ts`). Запуск на проде — из worker-контейнера: `docker compose exec -T worker npx tsx scripts/<имя>.ts`. Прод neurofax — демо-среда без реальных пациентов.

### ⚠️ Деструктивные (вытирают данные)

| Скрипт | Что делает |
|---|---|
| `wipe-neurofax-demo.ts` | **Только WIPE, без пересева. Необратимо.** Сносит все patient-derived строки клиники neurofax (записи, платежи, чаты, документы, лиды, аудит…), строго по clinicId; сохраняет каркас: Clinic/Branch/User/Doctor/Service/Cabinet/расписания/шаблоны. Удаление child-before-parent под FK |
| `seed-mega-neurofax.ts` | **WIPE + пересев** (~888 строк): та же чистка, затем богатый снапшот «клиника в разгаре работы» — пациенты с историей/семьями/аллергиями, визиты, кейсы, VisitNote, рецепты, больничные, лабы, платежи, инвойсы, чаты, звонки, Actions, AuditLog. Основной демо-ресид прода |
| `seed-today-live.ts` | **Удаляет ТОЛЬКО сегодняшние записи** (child rows first) и перестраивает живую очередь «на сейчас» через общий билдер `_live-queue-seed.ts`: корректные two-lanes, иммутабельный `ticketSeq`, `queuedAt`, «срочно»-буст, поздний приход — по каждому врачу с активным расписанием на ташкентский день недели (фикс UTC→Tashkent для TV-борда). Идемпотентен, безопасен для многократного прогона между показами |
| `seed-neurofax-real.ts` | Перезаписывает каталог neurofax реальным продовым составом: 5 кабинетов (№3 намеренно нет), 7 врачей с фикс-кабинетами, 13 услуг. Не удаляет — деактивирует старые (isActive=false), история сохраняется |
| `seed-demo-data.ts` | ~80 (env `PATIENTS=N`) демо-пациентов с документами/записями/платежами; идемпотентен (phoneNormalized + префикс `demo:`); **`CLEAN=1` — режим чистки** |
| `seed-clinical-life.ts` | Слой поверх seed-demo-data: visit notes, lab orders+results, э-рецепты, meds-напоминания, med-история, отзывы, год AuditLog-шума. Идемпотентен через тег `[ultra]` — **строки прошлого прогона вычищает** перед пересевом |
| `seed-doctor-qa.ts` | QA-сид кабинета врача (neurologist@neurofax.uz / пароль doctor): все состояния /doctor/*. Идемпотентен, **чистит строки с QA_TAG** перед пересевом |
| `seed-joe-two.ts` | Два WAITING-визита подряд для врача joe (ручной тест single-active-visit guard); чистит свои прошлые остатки |

### Недеструктивные (только добавляют/апсертят)

| Скрипт | Что делает |
|---|---|
| `seed-prod-demo.ts` | Прод-безопасный: апсерт 11 NotificationTemplate + 30 демо-пациентов в диапазоне `+998999100XXXX` (легко отличить), по 1 прошлому COMPLETED (+PAID Payment) и 1 будущему BOOKED. Не трогает реальных юзеров/врачей/услуги; не создаёт demo-clinic и `1@1.uz` на проде |
| `seed-knowledge.ts` | Глобальная база `DiagnosisGuide` (clinicId=null), нейро-профиль RU+UZ; глобальные строки обновляет (сид — источник истины), клиничные не трогает |
| `seed-notification-templates.ts` | 8 дефолтных шаблонов уведомлений каждой клинике; существующие `(clinicId, key)` не перезаписывает (правки админа выживают) |
| `seed-labs-reminders-dev.ts` | Dev-only: Reminder + LabResult к существующим врачам/пациентам; скипает врача, у которого уже есть |
| `total-stress-seed.ts` | Стресс-объём для neurofax (~30 пациентов, ~150 записей во всех статусах, платежи); идемпотентен по префиксу `STRESS-` |
| `bootstrap-super-admin.ts` | Апсерт `super@neurofax.uz` (SUPER_ADMIN), пароль из env `SUPER_PASS` |
| `upsert-dev-admin.ts` | Dev-шорткат `1@1.uz` / пароль «1», ADMIN клиники neurofax |
| `_live-queue-seed.ts` | Не самостоятельный скрипт — общий билдер живой очереди, используется mega/today-live сидами |

*(Остальные `stress-*.ts`, `check-*`, `inspect-*`, `fix-*`, `encrypt-existing-pii.ts`, `rotate-encryption-key.ts` — не сиды: стресс-тесты, диагностика и one-shot-миграции данных.)*
