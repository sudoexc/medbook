/**
 * «Is the key this script holds the key the app uses?», answered before the
 * first write of an encryption backfill (audit G2-11).
 *
 * `encrypt-existing-pii` and `encrypt-auth-secrets` turn plaintext into
 * ciphertext under whatever key their own process resolved. If that is not
 * the app's key, the rows they touch are unreadable to the app: patient cards
 * with a passport or a note answer 500, doctors with 2FA cannot sign in and
 * the clinics' Telegram bots stop. And if it is the public dev key (derived
 * in field-cipher.ts from a string in the source), anyone with a dump and the
 * repository reads those rows. Both were one slip away: encrypt-auth-secrets
 * pulled APP_SECRET from the laptop's `.env` next to a production
 * DATABASE_URL, and encrypt-existing-pii only printed a WARNING before
 * encrypting under the dev key.
 *
 * The check needs no stored fingerprint: AES-GCM authenticates the key, so
 * decrypting ciphertext the app wrote earlier proves the key matches, and one
 * failure proves it does not. The scripts sample the newest ciphertext of
 * every column they write and stop on any failure. A database with nothing
 * encrypted yet has nothing to compare against: outside a local database the
 * run then needs `--first-run`, typed by someone who checked the key.
 *
 * Pure; unit tested in tests/unit/cipher-key-guard.test.ts.
 */
export type CipherSample = {
  /** Where the value came from, for the refusal (`Patient.passport <id>`). */
  where: string;
  value: string;
};

export type KeyCheck =
  | { ok: true; checked: number; firstRun: boolean }
  | {
      ok: false;
      reason: "key_mismatch" | "no_reference" | "dev_key" | "placeholder_secret";
      message: string;
    };

/**
 * Strict shape of our `v<n>:<iv>:<tag>:<ct>` envelope (12-byte IV, 16-byte
 * tag, base64). Stricter than `isEncryptedField`, so a plaintext note that
 * merely starts with «v2:» is not taken for ciphertext and reported as a
 * key mismatch.
 */
const ENVELOPE = /^v\d+:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]*={0,2}$/;

export function looksLikeCiphertext(value: string | null | undefined): value is string {
  return typeof value === "string" && ENVELOPE.test(value);
}

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * True when DATABASE_URL points at this machine. A tunnel to production on
 * localhost looks local too; that case is caught by the decrypt check, since
 * production has ciphertext the wrong key cannot open.
 */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_DB_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Decide whether the backfill may write. Order: a public or placeholder key
 * outside development first (it must never produce ciphertext on real data,
 * matching or not), then the decrypt check, then the «nothing to compare»
 * case.
 */
export function decideKeyCheck(input: {
  script: string;
  /** The key in use is the deterministic dev fallback (field cipher). */
  isDevKey?: boolean;
  /** The secret in use is a `.env.example` placeholder (auth secrets). */
  isPlaceholderSecret?: boolean;
  samples: CipherSample[];
  decrypt: (value: string) => unknown;
  env: Record<string, string | undefined>;
  argv: string[];
}): KeyCheck {
  const { script, samples, decrypt, env, argv } = input;
  const production = env.NODE_ENV === "production";
  const local = isLocalDatabaseUrl(env.DATABASE_URL);
  const development = !production && local;

  if (input.isDevKey && !development) {
    return {
      ok: false,
      reason: "dev_key",
      message: [
        "",
        `⛔ ${script}: ключ шифрования не задан, это публичный dev-ключ из исходников.`,
        "   Им можно шифровать только локальную базу разработчика. Здесь данные стали бы",
        "   читаемы для любого, у кого есть дамп и репозиторий, а приложение не смогло бы",
        "   их расшифровать. Запускай внутри контейнера worker, где ключ из .env сервера.",
        "",
      ].join("\n"),
    };
  }

  if (input.isPlaceholderSecret && !development) {
    return {
      ok: false,
      reason: "placeholder_secret",
      message: [
        "",
        `⛔ ${script}: APP_SECRET / AUTH_SECRET равен заглушке из .env.example.`,
        "   Это не ключ приложения. Запускай внутри контейнера worker.",
        "",
      ].join("\n"),
    };
  }

  for (const s of samples) {
    try {
      decrypt(s.value);
    } catch (e) {
      return {
        ok: false,
        reason: "key_mismatch",
        message: [
          "",
          `⛔ ${script}: ключ этого запуска НЕ совпадает с ключом приложения.`,
          `   Не расшифровывается уже зашифрованное значение ${s.where}`,
          `   (${(e as Error).message}).`,
          "   Запись под этим ключом сделала бы данные нечитаемыми для приложения.",
          "   Ничего не записано. Запускай внутри контейнера worker, где ключ из .env сервера.",
          "",
        ].join("\n"),
      };
    }
  }

  if (samples.length === 0 && !development && !argv.includes("--first-run")) {
    return {
      ok: false,
      reason: "no_reference",
      message: [
        "",
        `⛔ ${script}: в базе нет ни одного зашифрованного значения, сверить ключ не с чем.`,
        "   Если это действительно первое шифрование, сверь ключ с .env сервера и добавь --first-run.",
        "",
      ].join("\n"),
    };
  }

  return { ok: true, checked: samples.length, firstRun: samples.length === 0 };
}
