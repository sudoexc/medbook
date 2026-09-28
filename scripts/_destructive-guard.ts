/**
 * The one safety interlock for every script that writes demo or test data
 * (audit G2-01, G2-02, G2-05, G2-06, G2-07).
 *
 * Production is the real NeuroFax clinic: reception runs the live queue,
 * doctors sign conclusions, patients book through Telegram. A seed run
 * against it deletes medical records, signs made-up conclusions in real
 * doctors' names, takes real patients' slots and adds revenue nobody paid.
 * So every demo or test seed calls `assertSeedAllowed` before its first
 * write, and this helper decides, in order:
 *
 *   1. Dev-only scripts (stress tests, QA seeds, fake clinical history, and
 *      the seeds hard-wired to the real clinic's slug) never run with
 *      NODE_ENV=production. There is no override: the worker image is
 *      production, and nothing those scripts write belongs there.
 *   2. Scripts that DELETE rows never run with NODE_ENV=production either,
 *      opt-in or not (audit G2-03 review): the only production database is
 *      the real clinic, and a wipe there takes signed conclusions with it.
 *   3. Scripts that DELETE rows never run on a clinic with signed
 *      conclusions, in any environment and with no opt-in (audit G2-05).
 *   4. A clinic that holds real data, or any clinic with NODE_ENV=production,
 *      needs `ALLOW_DEMO_SEED_ON_REAL_DATA=<clinic slug>`. The value names the
 *      clinic: an opt-in exported for one clinic cannot carry over to another.
 *      The refusal never prints the slug it refused (it used to end with a
 *      ready-to-paste bypass for the real clinic): whoever opts in types the
 *      demo clinic's slug themselves. Scripts that sign documents as the
 *      clinic's doctors get no opt-in at all.
 *   5. Scripts that DELETE rows need `--force`, so a command copied from a
 *      doc or the shell history does nothing by itself.
 *
 * Real data is read from what only the running app writes (audit G2-05):
 *   - signed conclusions: a `VisitNoteRevision` SIGNED row is written by the
 *     finalize route and by nothing else, seeds included. It does not depend
 *     on the audit trail (a wipe of AuditLog or a quiet holiday week changes
 *     nothing) and it disappears only with the documents themselves. A script
 *     that DELETES rows never runs on a clinic that has one: no opt-in, no
 *     flag. Signed conclusions are medical records. (Those of demo patients,
 *     tagged DEMO_SEED_MARK, are not counted.)
 *   - staff work in the audit trail: rows by a signed-in staff member for
 *     work only the app does (a patient card created at reception, a walk-in
 *     ticket, a conclusion written or signed).
 *   - people working in the deployment right now: audit rows with an actor
 *     over the last 72 h. System rows (the outbox mirror of automatic events,
 *     the no-show sweep) are not counted: they made a clean demo look «real»
 *     and taught operators to reach for the bypass.
 *
 * A refusal names no ready bypass: the opt-in shows a placeholder slug, and a
 * clinic with real data never sees an «add --force» hint first.
 *
 * Usage, first thing in main():
 *
 *   import { assertSeedAllowed } from "./_destructive-guard";
 *   await assertSeedAllowed(prisma, { script: "seed-today-live", clinicSlug: SLUG, destructive: true });
 *
 * Not for the production data fixes (backfills and fix-* scripts with DRY RUN
 * and APPLY=1): those are written for the real clinic on purpose.
 */

import { DEMO_SEED_MARK } from "../src/lib/demo-seed";

/** Env var that lets a demo seed touch a clinic with real data. Value: the clinic slug. */
export const REAL_DATA_OPT_IN_ENV = "ALLOW_DEMO_SEED_ON_REAL_DATA";

/**
 * Audit actions only the running app writes, always on behalf of a signed-in
 * staff member. Seeds never write these: the fake «year of audit noise» that
 * seed-clinical-life used to add was `user.signin`, `appointment.create`,
 * `payment.create`, `visitnote.finalize` and the like, which is why none of
 * those are here (a dev database it once ran on must not look «real»).
 */
export const REAL_WORK_ACTIONS = [
  "patient.create",
  "appointment.walkin_issued",
  "visit_note.create",
  "visit_note.update",
  "visit_note.finalize",
  "visit_note.print",
  "document.create",
  "medical_case.create",
] as const;

/** Any staff row above counts: one real walk-in means real patients. */
const REAL_WORK_THRESHOLD = 1;
const ACTIVITY_WINDOW_HOURS = 72;
/** Below this, recent rows are almost certainly our own tooling. */
const ACTIVITY_ROW_THRESHOLD = 20;

export type SeedPolicy = {
  /** Script name without extension, for the messages. */
  script: string;
  /** The clinic the script writes to. */
  clinicSlug: string;
  /** How it is run, for the hints (default `npx tsx scripts/<script>.ts`). */
  command?: string;
  /** Deletes rows: needs `--force`. */
  destructive?: boolean;
  /** Test or QA tooling: refused outright with NODE_ENV=production. */
  devOnly?: boolean;
  /**
   * Writes documents signed by the clinic's doctors (seed-clinical-life): on
   * a clinic with real data those are real people, so the opt-in does not
   * apply and the only way is a fresh database.
   */
  neverOnRealData?: boolean;
};

export type RealDataSignals = {
  /** Staff-authored audit rows for REAL_WORK_ACTIONS in this clinic, all time. */
  staffActions: number;
  /**
   * Audit rows with a person behind them, whole database, over the last
   * ACTIVITY_WINDOW_HOURS.
   */
  recentActivity: number;
  /**
   * Conclusions signed through the app in this clinic (VisitNoteRevision
   * SIGNED rows). Audit-independent; blocks every destructive script.
   */
  signedConclusions: number;
};

export type SeedGuardInput = {
  policy: SeedPolicy;
  signals: RealDataSignals;
  env: Record<string, string | undefined>;
  argv: string[];
};

export type SeedGuardDecision =
  | { ok: true; realData: boolean; warning: string | null }
  | {
      ok: false;
      reason:
        | "dev_only_in_production"
        | "destructive_in_production"
        | "needs_force"
        | "signed_documents"
        | "real_data";
      message: string;
    };

export function hasRealData(s: RealDataSignals): boolean {
  return (
    s.signedConclusions > 0 ||
    s.staffActions >= REAL_WORK_THRESHOLD ||
    s.recentActivity >= ACTIVITY_ROW_THRESHOLD
  );
}

function describeSignals(s: RealDataSignals): string[] {
  const out: string[] = [];
  if (s.signedConclusions > 0) {
    out.push(
      `   В клинике ${s.signedConclusions} подписанных в приложении заключений.`,
    );
  }
  if (s.staffActions >= REAL_WORK_THRESHOLD) {
    out.push(
      `   В журнале ${s.staffActions} действий персонала: карточки пациентов, талоны живой очереди, заключения.`,
    );
  }
  if (s.recentActivity >= ACTIVITY_ROW_THRESHOLD) {
    out.push(
      `   За последние ${ACTIVITY_WINDOW_HOURS} ч в системе ${s.recentActivity} действий пользователей.`,
    );
  }
  return out;
}

/** Pure decision, unit tested; `assertSeedAllowed` wires it to the database. */
export function decideSeedGuard(input: SeedGuardInput): SeedGuardDecision {
  const { policy, signals, env, argv } = input;
  const production = env.NODE_ENV === "production";
  const realData = hasRealData(signals);
  const cmd = policy.command ?? `npx tsx scripts/${policy.script}.ts`;

  if (policy.devOnly && production) {
    return {
      ok: false,
      reason: "dev_only_in_production",
      message: [
        "",
        `⛔ ${policy.script} пишет тестовые данные и работает только на локальной базе.`,
        "   Сейчас NODE_ENV=production. Обхода нет: на проде этот скрипт не нужен никогда.",
        "",
      ].join("\n"),
    };
  }

  // Before the --force check: on production its hint («add --force») was
  // the first step of the walk to the bypass.
  if (policy.destructive && production) {
    return {
      ok: false,
      reason: "destructive_in_production",
      message: [
        "",
        `⛔ ${policy.script} УДАЛЯЕТ данные клиники «${policy.clinicSlug}».`,
        "   Сейчас NODE_ENV=production, а на проде работает реальная клиника.",
        "   Обхода нет: ни --force, ни переменные окружения здесь не помогут.",
        "   Демо показывают на локальной базе (docs/operations/RUNBOOK.md §5.2).",
        "",
      ].join("\n"),
    };
  }

  // Audit G2-05: signed conclusions are medical records, and a script that
  // deletes rows takes them with it (wipe-neurofax-demo even deletes the
  // audit trail the other signals read). Outside production too: a laptop
  // with DATABASE_URL pointing at the live database is not production by
  // NODE_ENV. No opt-in applies.
  if (policy.destructive && signals.signedConclusions > 0) {
    return {
      ok: false,
      reason: "signed_documents",
      message: [
        "",
        `⛔ Отказ: ${policy.script} УДАЛЯЕТ данные, а в клинике «${policy.clinicSlug}» есть подписанные заключения.`,
        ...describeSignals(signals),
        "   Это медицинские документы. Скрипт, который удаляет строки, на такой клинике",
        "   не запускается никогда: ни --force, ни переменные окружения здесь не помогут.",
        "   Демо-данные живут в отдельной демо-клинике или на новой локальной базе.",
        "",
      ].join("\n"),
    };
  }

  if (policy.neverOnRealData && realData) {
    return {
      ok: false,
      reason: "real_data",
      message: [
        "",
        `⛔ Отказ: в клинике «${policy.clinicSlug}» реальные данные.`,
        ...describeSignals(signals),
        `   ${policy.script} подписывает заключения, рецепты и задачи от имени врачей клиники,`,
        "   здесь это были бы реальные люди. Обхода нет: только чистая локальная база.",
        "",
      ].join("\n"),
    };
  }

  const optIn = env[REAL_DATA_OPT_IN_ENV];
  if ((realData || production) && optIn !== policy.clinicSlug) {
    const why = realData
      ? describeSignals(signals)
      : ["   NODE_ENV=production: это боевая среда."];
    const lines = [
      "",
      `⛔ Отказ: ${policy.script} не пишет в клинику «${policy.clinicSlug}».`,
      ...why,
      "   Демо-пациенты, визиты и оплаты попали бы в списки, расписание и выручку",
      "   клиники, а удаление задело бы медицинские документы.",
      "",
    ];
    if (optIn && optIn !== policy.clinicSlug) {
      lines.push(
        `   ${REAL_DATA_OPT_IN_ENV}=${optIn} называет другую клинику.`,
        "",
      );
    }
    if (argv.includes("--i-know-there-is-real-data")) {
      lines.push(
        "   Флаг --i-know-there-is-real-data больше не действует.",
        "",
      );
    }
    // A placeholder, never the refused slug: a hint that spells out
    // `=neurofax` is a bypass for the real clinic one paste away.
    lines.push(
      "   Демо-данные живут в отдельной демо-клинике или на локальной базе.",
      "   Только если это действительно демо-клиника, впиши её slug сам:",
      `     ${REAL_DATA_OPT_IN_ENV}=<slug демо-клиники> ${cmd}${policy.destructive ? " --force" : ""}`,
      "",
    );
    return { ok: false, reason: "real_data", message: lines.join("\n") };
  }

  // After the real-data checks on purpose (audit G2-05): on a clinic with
  // real data the first answer used to be «add --force», the first step of
  // the walk to the bypass.
  if (policy.destructive && !argv.includes("--force")) {
    return {
      ok: false,
      reason: "needs_force",
      message: [
        "",
        `⛔ ${policy.script} УДАЛЯЕТ данные клиники «${policy.clinicSlug}».`,
        "   Без флага --force он ничего не делает:",
        `     ${cmd} --force`,
        "",
      ].join("\n"),
    };
  }

  return {
    ok: true,
    realData,
    warning:
      realData || production
        ? `⚠️  ${policy.script}: клиника «${policy.clinicSlug}» названа в ${REAL_DATA_OPT_IN_ENV}, продолжаю по явному подтверждению.\n`
        : null,
  };
}

/** The slice of PrismaClient the probe reads; a real client fits as is. */
export type SeedGuardDb = {
  clinic: {
    findUnique(args: {
      where: { slug: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  auditLog: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  visitNoteRevision: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
};

export async function probeRealData(
  db: SeedGuardDb,
  clinicId: string,
  now: Date = new Date(),
): Promise<RealDataSignals> {
  const since = new Date(now.getTime() - ACTIVITY_WINDOW_HOURS * 3600_000);
  const [staffActions, recentActivity, signedConclusions] = await Promise.all([
    db.auditLog.count({
      where: {
        clinicId,
        actorId: { not: null },
        action: { in: [...REAL_WORK_ACTIONS] },
      },
    }),
    // Whole database on purpose: the question is «is anyone working in this
    // deployment», and a seed pointed at a sibling clinic is still a mistake.
    // People only: workers write rows on their own around the clock.
    db.auditLog.count({
      where: { createdAt: { gte: since }, actorId: { not: null } },
    }),
    // Written by the finalize route only (src/server/visit-notes/revisions.ts),
    // never by a seed, so it survives a wiped audit trail. Conclusions signed
    // while showing the demo to demo patients (tag DEMO_SEED_MARK) are not
    // medical records and do not lock a demo clinic's re-seed.
    db.visitNoteRevision.count({
      where: {
        clinicId,
        kind: "SIGNED",
        visitNote: { patient: { NOT: { tags: { has: DEMO_SEED_MARK } } } },
      },
    }),
  ]);
  return { staffActions, recentActivity, signedConclusions };
}

/**
 * Resolve the clinic, probe it and stop the process (exit 1) before the
 * first write when the policy refuses. Returns the clinic id.
 */
export async function assertSeedAllowed(
  db: SeedGuardDb,
  policy: SeedPolicy,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
): Promise<{ clinicId: string; realData: boolean }> {
  const r = await guardClinic(db, policy, env, argv, false);
  return { clinicId: r.clinicId as string, realData: r.realData };
}

/**
 * The same interlock for a seed that creates the clinic when it is missing
 * (prisma/seed.ts on a fresh database): a clinic that does not exist yet has
 * nothing to protect, so it passes with `clinicId: null`.
 */
export async function assertSeedAllowedOrNewClinic(
  db: SeedGuardDb,
  policy: SeedPolicy,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv.slice(2),
): Promise<{ clinicId: string | null; realData: boolean }> {
  return guardClinic(db, policy, env, argv, true);
}

async function guardClinic(
  db: SeedGuardDb,
  policy: SeedPolicy,
  env: Record<string, string | undefined>,
  argv: string[],
  allowMissing: boolean,
): Promise<{ clinicId: string | null; realData: boolean }> {
  if (!policy.clinicSlug) {
    console.error(`⛔ ${policy.script}: не указана клиника (CLINIC_SLUG).`);
    process.exit(1);
  }
  // Production refusals first: they must not depend on the database answering.
  if ((policy.devOnly || policy.destructive) && env.NODE_ENV === "production") {
    const d = decideSeedGuard({
      policy,
      signals: { staffActions: 0, recentActivity: 0, signedConclusions: 0 },
      env,
      argv,
    });
    if (!d.ok) console.error(d.message);
    process.exit(1);
  }
  const clinic = await db.clinic.findUnique({
    where: { slug: policy.clinicSlug },
    select: { id: true },
  });
  if (!clinic) {
    if (allowMissing) {
      // Nothing to protect yet; the dev-only/production refusals above
      // already ran. Destructive seeds still need --force.
      const d = decideSeedGuard({
        policy,
        signals: { staffActions: 0, recentActivity: 0, signedConclusions: 0 },
        env,
        argv,
      });
      if (!d.ok) {
        console.error(d.message);
        process.exit(1);
      }
      return { clinicId: null, realData: false };
    }
    console.error(`⛔ ${policy.script}: клиника «${policy.clinicSlug}» не найдена.`);
    process.exit(1);
  }
  const signals = await probeRealData(db, clinic.id);
  const decision = decideSeedGuard({ policy, signals, env, argv });
  if (!decision.ok) {
    console.error(decision.message);
    process.exit(1);
  }
  if (decision.warning) console.warn(decision.warning);
  return { clinicId: clinic.id, realData: decision.realData };
}

/**
 * CLINIC_SLUG for scripts that used to default to "neurofax" (the real
 * clinic): now it has to be named for every run.
 */
export function requireClinicSlug(
  script: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const slug = env.CLINIC_SLUG?.trim();
  if (slug) return slug;
  console.error(
    [
      "",
      `⛔ ${script}: укажи клинику явно, умолчания больше нет.`,
      `     CLINIC_SLUG=<slug демо-клиники> npx tsx scripts/${script}.ts`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True for an http(s) URL on this machine; anything else is a live site. */
export function isLocalHttpTarget(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      LOCAL_HOSTS.has(u.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * For the stress scripts that drive the HTTP API instead of the database
 * (audit G2-05): they create payments and delete settings rows through the
 * real routes, so pointed at the live site they do to the clinic what the
 * database seeds would. Local app only, never with NODE_ENV=production.
 */
export function assertLocalHttpTarget(
  script: string,
  baseUrl: string,
  env: Record<string, string | undefined> = process.env,
): void {
  if (env.NODE_ENV !== "production" && isLocalHttpTarget(baseUrl)) return;
  console.error(
    [
      "",
      `⛔ ${script} создаёт и удаляет данные через API и работает только с локальным приложением.`,
      `   Адрес ${baseUrl} не локальный${env.NODE_ENV === "production" ? ", а NODE_ENV=production" : ""}. Обхода нет.`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}
