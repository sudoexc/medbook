# Документация MedBook / NeuroFax

Мульти-тенантная CRM для клиник: кабинет врача, ресепшн, колл-центр, админ-консоль
платформы, Telegram Mini App для пациента и экраны в холле (ТВ-очередь, киоск, талон).

Прод: **neurofax.uz** (self-hosted Hetzner VPS).

> **Как читать эту документацию.** Разделы ниже разбиты на две группы: **для людей**
> (инструкции сотрудникам клиники и пациентам) и **для разработчиков** (архитектура,
> данные, эксплуатация). Каталог `docs/TZ*.md` — это **технические задания**, то есть
> «что планировали построить». Они не всегда совпадают с реальностью: часть
> заспеченного не реализована или переделана. **Источник истины о текущем поведении —
> код и разделы «Архитектура» ниже.**

---

## 📘 Инструкции пользователя

Написаны простым языком, для сотрудников клиники и пациентов.

| Документ | Для кого | О чём |
|---|---|---|
| [manual/VRACH.md](manual/VRACH.md) | Врач | Вход, «Мой день», полный цикл приёма от вызова пациента до печати заключения, пациенты, заключения, статистика, частые вопросы |
| [manual/RESEPSHN.md](manual/RESEPSHN.md) | Ресепшн, колл-центр | Запись пациентов, приём пришедших, живая очередь и талоны, календарь, оплаты, звонки и лиды, Telegram |
| [manual/ADMIN-KLINIKI.md](manual/ADMIN-KLINIKI.md) | Руководитель клиники | Первый запуск по шагам, врачи и расписания, услуги и цены, роли сотрудников, напоминания пациентам, подключение Telegram-бота, безопасность, ТВ-экраны |
| [manual/PACIENT.md](manual/PACIENT.md) | Пациент | Telegram Mini App: записи, документы, лекарства, анализы; напоминания; экраны в холле, талон, проверка подлинности документа |

### 🖨 Версия для печати и показа

**[manual/index.html](manual/index.html)** — все четыре инструкции одной страницей:
навигация по разделам, вёрстка под печать (каждая роль с новой страницы). Файл
самодостаточный — открывается двойным кликом, отправляется в мессенджере,
печатается в PDF через «Печать» в браузере.

Пересобрать после правки markdown-инструкций:

```bash
npm run docs:manual
```

Дополнительно: [pamyatka-zhivaya-ochered.html](pamyatka-zhivaya-ochered.html) — печатная
памятка по живой очереди.

---

## 🏗 Архитектура (как система устроена сейчас)

| Документ | О чём |
|---|---|
| [architecture/OVERVIEW.md](architecture/OVERVIEW.md) | С чего начать. Поверхности и роли, карта репозитория, жизненный цикл запроса (`createApiHandler`), фоновые воркеры, хранилище файлов, локализация, что выключено (AI, SMS) |
| [architecture/DATA-MODEL.md](architecture/DATA-MODEL.md) | Модель данных: все ~80 моделей по доменам, ключевые таблицы детально, мульти-тенантная изоляция, медико-правовые ограничения на удаление, миграции, сиды |
| [architecture/QUEUE.md](architecture/QUEUE.md) | Модель «двух полос»: записи по времени ⊥ живая очередь FIFO. Талоны, статусы приёма и переходы, правило «один приём за раз», кто считается текущим пациентом |
| [architecture/REALTIME.md](architecture/REALTIME.md) | Реалтайм: outbox → SSE → браузер, каталог событий, **два поколения конверта событий (v1/v2)** — главный подводный камень проекта |
| [architecture/NOTIFICATIONS-TELEGRAM.md](architecture/NOTIFICATIONS-TELEGRAM.md) | Уведомления и Telegram-контур: шаблоны, триггеры, каскад напоминаний (5 дней / 3 дня / 1 день / 3 часа), бот, Mini App, чат с пациентом |
| [architecture/SECURITY.md](architecture/SECURITY.md) | Аутентификация, 2FA, роли, **изоляция клиник**, шифрование, аудит, приватность файлов, DSAR, известные слабые места |

---

## 🚀 Эксплуатация

| Документ | О чём |
|---|---|
| [operations/DEPLOY.md](operations/DEPLOY.md) | Как задеплоить: проверки перед деплоем, реальный процесс на сервере, как убедиться что всё поднялось, откат, подводные камни |
| [operations/RUNBOOK.md](operations/RUNBOOK.md) | Контейнеры и соседи по VPS, диагностика, типовые инциденты (502, реалтайм, уведомления, диск, воркер), бэкапы, обслуживание демо-данных |
| [operations/NEW-CLINIC.md](operations/NEW-CLINIC.md) | Подключение новой клиники: что создаётся, чеклист онбординга, домен, Telegram-бот |
| [runbooks/](runbooks/) | Частные процедуры: кастомный поддомен, ротация ключа шифрования |

> ⚠️ **Важно:** на текущем сервере **не настроен автоматический бэкап базы** —
> см. раздел «Бэкап и восстановление» в [RUNBOOK.md](operations/RUNBOOK.md).

---

## 🔌 Справочник API

[api/](api/) — по доменам: [appointments](api/appointments.md),
[patients](api/patients.md), [doctors](api/doctors.md),
[documents](api/documents.md), [payments](api/payments.md),
[communications](api/communications.md),
[services-cabinets](api/services-cabinets.md), [misc](api/misc.md).

Общие правила ответов и обработки ошибок — в
[architecture/OVERVIEW.md](architecture/OVERVIEW.md), раздел «Жизненный цикл запроса».

---

## 🎨 Дизайн

[DESIGN-DOCTRINE.md](DESIGN-DOCTRINE.md) — принципы интерфейса, палитра, типографика,
каталог базовых компонентов. **Сверяться до создания новых компонентов.**

---

## 📋 Технические задания (история решений)

Это спецификации, по которым велась разработка. Полезны, чтобы понять **почему**
сделано так, а не иначе. Не считать описанием текущего поведения.

| Документ | Тема |
|---|---|
| [TZ.md](TZ.md) | Основное ТЗ продукта |
| [TZ-two-lanes.md](TZ-two-lanes.md) | Разделение записей и живой очереди |
| [TZ-doctor-cabinet.md](TZ-doctor-cabinet.md) | Кабинет врача |
| [TZ-smart-constructor.md](TZ-smart-constructor.md) | Конструктор заключения, назначения, CDS |
| [TZ-cross-surface-sync.md](TZ-cross-surface-sync.md) | Синхронизация между поверхностями |
| [TZ-miniapp-overhaul.md](TZ-miniapp-overhaul.md) | Mini App пациента |
| [TZ-telegram-section.md](TZ-telegram-section.md) | Раздел Telegram в CRM |
| [TZ-notifications-cancel-sync.md](TZ-notifications-cancel-sync.md) | Уведомления при отменах/переносах |
| [TZ-sms-removal.md](TZ-sms-removal.md) | Отказ от SMS в пользу Telegram |
| [TZ-security-hardening.md](TZ-security-hardening.md) | Усиление безопасности |
| [TZ-risk-outcomes.md](TZ-risk-outcomes.md) | Работа с риском неявки, каскад напоминаний |
| [TZ-crm-stabilization.md](TZ-crm-stabilization.md) | Стабилизация CRM |
| [TZ-finishing-punch-list.md](TZ-finishing-punch-list.md) | Финальный список доработок |
| [ROADMAP-11x.md](ROADMAP-11x.md) | Роадмап фаз |

Роадмап кабинета врача: [`src/app/[locale]/doctor/_ROADMAP.md`](../src/app/%5Blocale%5D/doctor/_ROADMAP.md).

---

## 🧪 Качество и прочее

- [tests/](tests/) — заметки по тестированию · [a11y/](a11y/) — доступность ·
  [perf/](perf/) — производительность · [i18n/](i18n/) — локализация ·
  [db/](db/) — заметки по БД · [security/](security/) — чеклисты безопасности ·
  [audit/](audit/) — аудит · [progress/LOG.md](progress/LOG.md) — журнал фаз

---

## Быстрый старт для разработчика

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev                    # http://localhost:3000
```

Проверки перед коммитом:

```bash
rm -rf .next/dev                                                    # устаревший валидатор даёт ложные ошибки
node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit
npx vitest run
```

Подробнее — корневой [README.md](../README.md) и
[operations/DEPLOY.md](operations/DEPLOY.md).
