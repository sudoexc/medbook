# ТЗ — Кабинет врача: доведение до прод-готовности

> Составлено: 2026-06-09. Основано на аудите кабинета (4 параллельных прохода +
> ручная верификация ключевых claim'ов). Источник истины по разблокировке —
> `src/app/[locale]/doctor/_ROADMAP.md` §«Unpause readiness checklist»; этот
> документ его НЕ заменяет, а расширяет: добавляет закрытие cross-surface петель,
> новые клинические возможности и polish до уровня CRM.

## 0. Контекст и цель

Кабинет врача (`src/app/[locale]/doctor/**`) построен на ~70%: приёмы, SOAP-заметки,
рецепты, заказы лабораторных, больничные, e-prescription с QR — реально работают и
пишут в БД. Кабинет **выключен** за `DOCTOR_CABINET_ENABLED=1`
(`src/app/[locale]/doctor/layout.tsx`) — весь `/doctor/*` редиректит на `/crm`.

**Цель:** довести до состояния, когда гейт можно безопасно включить, замкнуть
разорванные петли «врач → пациент» и догнать UI/UX до полированного CRM.

**Продуктовый ориентир (что значит «сделано ахуенно»):** пациент выходит из
кабинета — а заключение, рецепты и направления уже у него в телефоне. Сейчас этот
цикл разорван в трёх местах (§3.1, §3.2, §4.1).

## 1. Scope

**In:** разблокировка (моки, 2FA, аудит), закрытие петель заключение/лаборатория,
клинические направления, ICD-10 автокомплит, polish + i18n кабинета.

**Out:** AI-rail (Phase 3b роадмапа — отдельный слой), голосовой ввод SOAP,
внешние интеграции с лабораториями (трансмиссия заказов/поллинг результатов),
RxNorm/формуляр лекарств. Эти пункты остаются на будущих фазах.

## 2. Приоритеты

| Фаза | Тема | Почему | Объём |
|---|---|---|---|
| **P0** | Разблокировка (safe-to-enable) | без этого включать опасно: фейк-данные + дыра в 2FA | S |
| **P1** | Замкнуть петлю ценности | данные есть, но не доходят до пациента — кабинет ощущается половинчатым | M |
| **P2** | Новые клинические возможности | направления, ICD-10, CDS-override | M–L |
| **P3** | Polish + i18n | догнать CRM, перевести на UZ | M (параллелится) |

---

## P0 — Разблокировка

### P0.1 Снести фейк-данные с живых экранов

**Проблема:** активные экраны рендерят `MOCK_*`. После включения гейта врач увидит
фейковые имена/диагнозы.

**Файлы и реальные источники:**

| Компонент | Сейчас тянет | Заменить на |
|---|---|---|
| `doctor/visits/[patientId]/_components/last-visit-card.tsx` | `reception/_mocks.ts:MOCK_LAST_VISIT` | последний `Appointment` (COMPLETED) + связанный `VisitNote` |
| `…/last-diagnosis-card.tsx` | `MOCK_LAST_DIAGNOSIS` | `VisitNote.diagnosisCode/diagnosisName` последнего визита |
| `…/patient-meta-row.tsx` | `MOCK_META_CHIPS` | `PatientAllergy` / `PatientChronicCondition` + активные `Prescription` |
| `doctor/patients/_components/ai-assistant-panel.tsx` | `patients/_mocks.ts:MOCK_AI_RECOS` | `/api/crm/doctors/me/patient-segments` (есть, role-gated); полноценный AI — Phase 3b |

**Заодно удалить** (не смонтированы, но импортируются — когнитивный шум):
`reception/_components/patient-header.tsx`, `reception/_components/visits-timeline.tsx`,
весь `reception/_active-mocks.ts`, `patients/_mocks.ts`, `reception/_mocks.ts`.

**Acceptance:** `grep MOCK_ src/app/[locale]/doctor/**` возвращает только удалённые/
закомментированные строки; живые экраны читают реальные данные.

### P0.2 Закрыть обход 2FA через `/api`

**Проблема:** `src/proxy.ts:268-272` исключает `/api` из matcher'а, а
`createApiHandler` (`src/lib/api-handler.ts`) не проверяет TOTP-enrollment. При
`Clinic.require2faForAll=true` врач без `User.totpEnabledAt` ходит в
`/api/crm/doctors/me/**` напрямую (curl/мобайл).

**Решение:** вставить gate внутрь `createApiHandler` / `createApiListHandler` —
после `buildContext`, до `runWithTenant`. Если `clinic.require2faForAll &&
!user.totpEnabledAt` → `403 { error: "MFA_REQUIRED" }`. Исключения: сами
эндпоинты enrollment'а (`/api/crm/me/security/**`).

**Blast-radius:** затрагивает ВСЕ `/api/crm/**`, не только доктора —
согласовать с CRM перед мержем. Покрыть vitest + интеграционным тестом.

**Acceptance:** доктор без `totpEnabledAt` в клинике с `require2faForAll=true`
получает `403 MFA_REQUIRED` на curl-POST `/api/crm/doctors/me/today`.

### P0.3 Закрыть пробел аудита

**Проблема:** `POST /api/crm/doctors/me/conversations/find-or-create`
(`route.ts:106-121`) создаёт `Conversation` (первый исходящий контакт клиники с
пациентом), шлёт SSE, но не вызывает `audit()`. Compliance-relevant.

**Решение:** добавить `audit({ action: AUDIT_ACTION.CONVERSATION_CREATED,
entityType: "Conversation", entityId: created.id, … })` после создания.

**Acceptance:** строка в `AuditLog` после первого cold-start outbound.

---

## P1 — Замкнуть петлю ценности

### P1.1 Заключение → пациент (ГЛАВНОЕ)

**Проблема:** врач пишет `VisitNote.patientHandoutMarkdown`, оно уходит **только в
PDF-печать** (`visit-notes/[id]/print/route.ts` использует `renderHandoutMarkdown`).
В miniapp — ноль: ни `Document`, ни consumer'а события. `docs/TZ-cross-surface-sync.md:432`
описывает, что карточка визита в miniapp должна получить `conclusionUrl` по событию
`visit-note.finalized` — но это поле никто не заполняет.

**Решение** (использует тот факт, что `/api/miniapp/documents` уже листает любой
`Document` пациента и проксирует файл — `route.ts:65-97`):

1. **Schema:** добавить `CONCLUSION` в `enum DocumentType`
   (`prisma/schema.prisma:178`). Также добавить в `ALLOWED_DOCUMENT_TYPES`
   miniapp-роута (`api/miniapp/documents/route.ts:38`).
2. **Worker** `visit-note-handout` — подписан на событие `visit-note.finalized`
   (уже публикуется через outbox, `finalize/route.ts:159`). На событие:
   - читает `VisitNote.patientHandoutMarkdown` (если пусто — деривит из
     структурных полей или пропускает, см. Open Q);
   - рендерит PDF тем же `renderHandoutMarkdown`, что и print-роут (вынести в
     `src/server/visit-notes/render-handout.ts`, переиспользовать);
   - грузит в MinIO, создаёт `Document { type: CONCLUSION, patientId,
     appointmentId, visitNoteId, fileUrl, title: "Заключение от {дата}" }`;
   - идемпотентность: upsert по `visitNoteId` — повторный finalize не плодит
     дубли (FINALIZED уже идемпотентен на уровне роута, `finalize/route.ts:59`).
   - **Только handout, никогда `bodyMarkdown`** (клинический текст пациенту не
     показываем).
3. **Miniapp карточка визита:** в `/api/miniapp/appointments` (scope=past)
   приджойнить `VisitNote → Document(type=CONCLUSION)` и отдать `conclusionUrl`
   = `/api/miniapp/documents/{id}/file`. Карточка прошедшего визита показывает
   кнопку «Заключение».

**Почему worker, а не inline в transaction:** рендер PDF — медленный внешний I/O,
в `$transaction` ему не место (`finalize` должен оставаться быстрым/идемпотентным).

**Acceptance:** врач финализирует приём → в течение ~неск. секунд handout-PDF
появляется в miniapp в «Документах» И на карточке визита (`conclusionUrl`).
Клинический `bodyMarkdown` пациенту недоступен.

### P1.2 Результаты анализов → пациент

**Проблема:** `/api/miniapp/labs` не существует (проверено glob'ом всех miniapp-
роутов). Врач заказывает (`LabOrder`) и ревьюит (`LabResult`), пациент не видит
ничего.

**Решение:**

1. **Новый эндпоинт** `GET /api/miniapp/labs?clinicSlug=…` —
   `createMiniAppListHandler`, возвращает `LabResult` где `patientId=ctx.patientId`
   И **`status=REVIEWED`** (клиническая безопасность: пациент видит результат
   только ПОСЛЕ ревью врача, не сырой PENDING/RESULTED с пугающими flag'ами).
   Поля: `testName, value, unit, refRange, flag, reviewedAt, doctorName,
   attachmentUrl?`.
2. **Событие:** на PATCH `doctors/me/labs/[id]` при переходе `→ REVIEWED`
   публиковать `lab.reviewed` (или переиспользовать существующий
   `lab.result.received` из `labs/route.ts:146`, но семантически чище новое).
   Miniapp инвалидирует `['miniapp','labs']`.
3. **Patient UI:** секция/страница `c/[slug]/my/labs` — список с цветовой +
   текстовой индикацией flag (NORMAL/HIGH/LOW/CRITICAL), референсные диапазоны.

**Acceptance:** врач помечает результат REVIEWED → пациент видит его в miniapp;
неотревьюенные результаты пациенту невидимы.

---

## P2 — Новые клинические возможности

### P2.1 Клинические направления (направления)

**Проблема:** в схеме только `ReferralCode`/`ReferralReward` (`schema.prisma:2666,
2728`) — это «приведи друга», лояльность. Модели «направить к специалисту» нет.

**Решение:**

1. **Schema** — новая модель:
   ```prisma
   model Referral {
     id            String         @id @default(cuid())
     clinicId      String
     patientId     String
     fromDoctorId  String
     toDoctorId    String?        // внутреннее направление к коллеге
     externalTo    String?        // внешняя клиника/специальность (текст)
     visitNoteId   String?
     reason        String
     diagnosisCode String?        // снапшот ICD-10 на момент направления
     diagnosisName String?
     status        ReferralStatus @default(PENDING)
     scheduledAppointmentId String? // если внутреннее и записан приём
     createdAt     DateTime       @default(now())
     updatedAt     DateTime       @updatedAt
     @@index([clinicId, toDoctorId, status])
     @@index([patientId])
   }
   enum ReferralStatus { PENDING SCHEDULED COMPLETED CANCELLED }
   ```
2. **API:** `POST /api/crm/referrals` (создать, role DOCTOR),
   `GET /api/crm/referrals?scope=incoming|outgoing`. Аудит + SSE
   (`referral.created`).
3. **Doctor UI:** действие «Направить» в `reception` (из активного приёма,
   снапшотит диагноз) + очередь входящих направлений у принимающего специалиста.
4. **Пациент:** генерим печатный PDF направления как `Document(type=REFERRAL)`
   (тот же механизм, что P1.1) — всплывает в miniapp автоматически.
5. **Внутреннее → запись:** связка с `bookAppointment` (предложить слот к
   `toDoctorId`) — опционально, можно вынести в P2-bis.

**Acceptance:** врач направляет пациента к коллеге → у принимающего появляется во
входящих, у пациента — печатное направление в miniapp.

### P2.2 ICD-10 автокомплит в диагнозе

**Проблема:** диагноз в `VisitNote` вбивается free-text; справочник ICD-10
(`/api/crm/icd10-search`, экран `references`) существует, но поле ввода диагноза с
ним не связано.

**Решение:** в `reception` диагноз-инпут → автокомплит из `/api/crm/icd10-search`,
пишет `diagnosisCode` + `diagnosisName` атомарно (как описано в роадмапе §3a.2).

**Acceptance:** ввод названия болезни предлагает ICD-10 коды; выбор заполняет оба
поля валидным кодом.

### P2.3 CDS-override (запись)

**Проблема:** `CdsOverride` модель есть (связана с `VisitNote`), но POST-эндпоинта
нет — врач не может заглушить CDS-алерт во время приёма (read-only).

**Решение:** `POST /api/crm/visit-notes/[id]/cds-overrides` — записать override с
причиной; аудит. CDS-карточка (`reception/_components/cds-warnings-card.tsx`)
получает кнопку «Принять риск» с обязательным комментарием.

**Acceptance:** врач может задокументировать override алерта; он сохраняется и
аудируется.

---

## P3 — Polish до уровня CRM + i18n

### P3.1 UI/UX — дотянуть до токен-парити

CRM прошёл polish-pass и задаёт планку; doctor-поверхность выглядит черновиком.
Топ-офендеры (file:line из аудита):

| Файл | Дефект | Фикс |
|---|---|---|
| `reception/_components/cds-warnings-card.tsx` | сырые `red-*/amber-*/blue-*/emerald-*` | токены `destructive/warning/info/success` |
| `documents/_components/upload-document-dialog.tsx` | кастомная модалка | `<Dialog>` из дизайн-системы |
| `patients/_components/patients-table.tsx:181` | голый текст вместо empty-state | `<EmptyState icon title description action/>` |
| `reception/_components/active-patient-card.tsx` | inline-стили кнопок | `<Button variant/size>` |
| `my-day/_components/schedule-card.tsx` | «Загружаем…» текст | структурные `<Skeleton>` ряды |
| `settings/_components/notifications-tab.tsx` | один высокий скелетон | field-by-field скелетоны |
| `_components/doctor-topbar.tsx` | нет focus-ring на поиске | `focus-visible:ring-ring` |

Сквозные: статусы только цветом → добавить текст+иконку; унифицировать радиусы
(`card`=xl, control=lg); responsive-префиксы (`md:`/`lg:`) в грид-диалогах;
retry-кнопки в error-стейтах.

**Метод:** это ровно тот же sweep, что прогнали по CRM — параллелится агентами
по-экранно.

### P3.2 i18n-sweep

**Проблема:** 66+ компонентов рендерят хардкод-кириллицу без `useTranslations`
(разбивка по экранам — в `_ROADMAP.md` §«i18n»). На UZ не переводится.

**Решение:** по-экранный sweep, namespace `doctor.*` в
`src/messages/{ru,uz}.json`, зеркалить структуру `crm.*`. Порядок: `reception` +
`my-day` первыми (макс. time-on-screen). Не блокировать включение полным
покрытием — UZ-врачи идут downstream после CRM-роллаута.

---

## 3. Сводка изменений данных (Prisma)

| Изменение | Тип | Фаза |
|---|---|---|
| `DocumentType += CONCLUSION` | enum | P1.1 |
| `Referral` + `ReferralStatus` | новая модель | P2.1 |
| `Referral.scheduledAppointmentId` ↔ `Appointment` back-relation | relation | P2.1 |

Миграции — идемпотентные (Prisma 7 паттерн: `DO $$ … EXCEPTION WHEN
duplicate_object`, `ADD COLUMN IF NOT EXISTS`). После деплоя верифицировать
`_prisma_migrations` + `information_schema.columns` (build-cache gotcha).

## 4. Cross-surface события (новые/уточнённые)

| Событие | Эмитится | Miniapp инвалидирует |
|---|---|---|
| `visit-note.finalized` (есть) | finalize | worker → `Document`; `['miniapp','appointments',patientId,'past']`, `['miniapp','documents']` |
| `lab.reviewed` (новое) | labs/[id] PATCH→REVIEWED | `['miniapp','labs']` |
| `referral.created` (новое) | referrals POST | `['miniapp','documents']` (направление-PDF) |

## 5. Definition of Done

> Сверено по коду 2026-06-19 (Wave B пунч-листа). `[x]` = подтверждено в
> исходниках + `tsc`/`i18n:check` зелёные. Это **код-верификация, не runtime-smoke**
> (браузерный прогон всех экранов под флагом — отдельно). Деплой-гейтнутые пункты
> остаются `[ ]` до фактического деплоя.

- [x] `grep MOCK_` в `/doctor/**` — чисто (только в `_*.md`-доках, не в исходниках)
- [x] 2FA-гейт в `createApiHandler` — `enforceTotpEnrollment` (`src/lib/api-handler.ts:216,326,403`) → `MFA_REQUIRED`
- [x] Финализация приёма → заключение в miniapp (`visit-note-handout` worker, durable sweep)
- [x] Отревьюенные анализы видны пациенту; PENDING/RESULTED — нет (`miniapp/labs/route.ts:32` `status:"REVIEWED"`)
- [x] Направление: врач создаёт → пациент получает PDF (`referral-dialog` + `referral-document` worker)
- [x] ICD-10 автокомплит в диагнозе (`use-icd10-search`, `icd10-browser`); CDS — `use-diagnosis-guide`
- [x] Doctor UI на токенах/атомах CRM; reception+my-day переведены (UZ) (`i18n:check` в парности)
- [ ] Всё аудируется в `AuditLog`; **миграции верифицированы на прод** — деплой-гейт
- [ ] Гейт `DOCTOR_CABINET_ENABLED=1` на staging → неделя smoke с одним врачом
      → прод — деплой-гейт

## 6. Последовательность (рекомендуемая)

1. **P0** целиком — мелко, обязательно, разблокирует включение.
2. **P1.1 как вертикальный срез** (заключение→пациент) — самый видимый эффект,
   доказывает ценность. Моки (P0.1) прибить попутно на тех же экранах.
3. **P1.2** (анализы) — тот же паттерн доставки.
4. **P2** — направления (тяжелейшее, новая модель), затем ICD-10/CDS.
5. **P3** — polish + i18n, параллельно агентами, не блокирует включение.

## 7. Open questions

- **Handout fallback:** если врач не заполнил `patientHandoutMarkdown` — деривить
  пациенто-понятный текст из структурных полей (complaints/advice) или не
  создавать `Document` вовсе? Лучше: создавать всегда, с авто-деривацией из
  `advice[]` + диагноза как минимум.
- **Letterhead в PDF:** заключение/направление — на бланке клиники
  (`Clinic.letterheadUrl`)? Подтвердить с Javohir.
- **Внутреннее направление → авто-слот:** предлагать запись к `toDoctorId` сразу
  или оставить ручной записью ресепшена? Лежит в P2.1 п.5 как опциональное.
- **`lab.reviewed` vs reuse `lab.result.received`:** новое событие семантически
  чище (received≠reviewed), но добавляет тип в реестр. Решить при реализации P1.2.
