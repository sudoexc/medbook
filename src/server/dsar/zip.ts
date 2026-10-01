/**
 * Phase 17 Wave 3 — DSAR encrypted-bundle packaging.
 *
 * Produces a self-describing `.zip` containing:
 *   • README.txt          — human-readable decryption instructions (RU+UZ+EN).
 *   • data.json.enc       — the JSON bundle, encrypted in the standard
 *                           `openssl enc` format (see below).
 *   • data.json.enc.hmac  — HMAC-SHA256 of data.json.enc, so a wrong
 *                           passphrase or a damaged file is reported as such.
 *   • decrypt.sh          — the script that checks and decrypts it with the
 *                           openssl already on any macOS or Linux machine.
 *
 * Why not standard ZIP encryption? Implementing PKZIP password-encrypted
 * entries (or AES-256 ZipCrypto) by hand is a maintenance trap — wrong
 * key derivation, wrong tag length, every ZIP tool decodes it slightly
 * differently. We instead emit a plain ZIP container with one
 * encrypted-blob entry that a stock `openssl` decrypts.
 *
 * The format (audit PT-09). It used to be AES-256-GCM with the tag in the
 * file and a decrypt.sh calling `openssl enc -d -aes-256-gcm -tag`: `openssl
 * enc` supports no AEAD cipher and has no `-tag` option, so no patient could
 * ever open their archive. Now it is exactly what
 *   openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -salt
 * writes («Salted__», 8-byte salt, AES-256-CBC with PKCS#7 padding; key and
 * IV from PBKDF2-HMAC-SHA256), which OpenSSL 1.1.1+, OpenSSL 3 and macOS's
 * LibreSSL all read. Integrity is encrypt-then-MAC: HMAC-SHA256 over the
 * whole data.json.enc, keyed with HMAC-SHA256(encryption key,
 * "medbook-dsar-mac"); decrypt.sh derives the same key with
 * `openssl enc -P` and `openssl dgst -mac HMAC`, and refuses before
 * decrypting when it does not match. A unit test runs decrypt.sh against a
 * bundle with the local openssl.
 *
 * The ZIP container itself is a minimal hand-rolled writer (one entry
 * per file, no compression, no extra fields, no zip64). The format
 * spec is short enough that this is auditable in a single file:
 *
 *   <local file headers + file data>...
 *   <central directory headers>...
 *   <end of central directory record>
 *
 * Each entry: 30-byte LFH + filename + STORED data.
 * Central dir: 46-byte CDH + filename per entry, then 22-byte EOCD.
 *
 * This keeps the dep tree small (no archiver / jszip) and the format
 * verifiable by hand against the PKZIP spec.
 */

import { createCipheriv, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";

const VERSION_NEEDED = 20; // ZIP 2.0
const STORED = 0; // no compression

// crc32 table (precomputed).
const CRC_TABLE: number[] = (() => {
  const tbl: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

type Entry = {
  name: string;
  body: Buffer;
};

/**
 * Hand-rolled minimal ZIP writer. STORED method only. Returns a single
 * Buffer ready to upload.
 */
export function buildZip(entries: Entry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.body);
    const size = entry.body.length;

    // Local file header.
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // signature
    lfh.writeUInt16LE(VERSION_NEEDED, 4); // version needed
    lfh.writeUInt16LE(0, 6); // gp bit flag
    lfh.writeUInt16LE(STORED, 8); // method
    lfh.writeUInt16LE(0, 10); // mod time
    lfh.writeUInt16LE(0, 12); // mod date
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(size, 18); // compressed size
    lfh.writeUInt32LE(size, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra length

    localChunks.push(lfh, nameBuf, entry.body);

    // Central directory header.
    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // signature
    cdh.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    cdh.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    cdh.writeUInt16LE(0, 8); // gp flags
    cdh.writeUInt16LE(STORED, 10);
    cdh.writeUInt16LE(0, 12);
    cdh.writeUInt16LE(0, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(size, 20);
    cdh.writeUInt32LE(size, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra length
    cdh.writeUInt16LE(0, 32); // comment length
    cdh.writeUInt16LE(0, 34); // disk number
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(0, 38); // external attrs
    cdh.writeUInt32LE(offset, 42); // local header offset

    centralChunks.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + entry.body.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralChunks);
  const centralSize = centralBuf.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk where central dir starts
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([Buffer.concat(localChunks), centralBuf, eocd]);
}

/** PBKDF2 iterations, as passed to `openssl enc -iter`. */
export const PBKDF2_ITERATIONS = 200_000;
const MAC_INFO = "medbook-dsar-mac";

/** Key and IV the way `openssl enc -pbkdf2 -md sha256` derives them. */
function deriveKeyIv(passphrase: string, salt: Buffer): { key: Buffer; iv: Buffer } {
  const out = pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 48, "sha256");
  return { key: out.subarray(0, 32), iv: out.subarray(32, 48) };
}

/** The MAC key: HMAC-SHA256(encryption key, "medbook-dsar-mac"). */
function macKeyOf(key: Buffer): Buffer {
  return createHmac("sha256", key).update(MAC_INFO).digest();
}

/**
 * Encrypt a UTF-8 plaintext in the `openssl enc -aes-256-cbc -pbkdf2 -iter
 * 200000 -md sha256 -salt` format, plus the hex HMAC-SHA256 of the result.
 *
 * Layout of `ciphertext`:
 *   bytes 0..7    — the ASCII magic «Salted__»
 *   bytes 8..15   — 8-byte random salt
 *   bytes 16..    — AES-256-CBC ciphertext, PKCS#7 padding
 */
export function encryptBundle(
  plaintext: string,
  passphrase: string,
): { ciphertext: Buffer; hmacHex: string } {
  const salt = randomBytes(8);
  const { key, iv } = deriveKeyIv(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const ciphertext = Buffer.concat([
    Buffer.from("Salted__", "ascii"),
    salt,
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const hmacHex = createHmac("sha256", macKeyOf(key)).update(ciphertext).digest("hex");
  return { ciphertext, hmacHex };
}

/**
 * Generate a random 24-character passphrase (3 groups of 8 a-z0-9 chars
 * separated by dashes for readability when the patient types it from
 * the Telegram message). 96 bits of entropy is plenty for a one-shot
 * passphrase that gates a 30-day-lived bundle.
 */
export function generatePassphrase(): string {
  const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789"; // no 0/o/l/1 (ambiguous)
  const bytes = randomBytes(24);
  const chars: string[] = [];
  for (let i = 0; i < 24; i++) {
    chars.push(ALPHA[bytes[i]! % ALPHA.length]!);
    if (i === 7 || i === 15) chars.push("-");
  }
  return chars.join("");
}

/**
 * Build the full encrypted bundle as a single .zip Buffer.
 *
 * `bundleJson`  — UTF-8 stringified bundle (typically ~50KB).
 * `passphrase`  — output of generatePassphrase().
 * `clinicNameRu`/`clinicNameUz` — woven into the README so the patient
 *                  knows which clinic the export is from. Optional.
 */
export function packDsarBundle(
  bundleJson: string,
  passphrase: string,
  clinicNameRu = "",
  clinicNameUz = "",
): Buffer {
  const { ciphertext, hmacHex } = encryptBundle(bundleJson, passphrase);

  const readme = [
    "MedBook: personal data export",
    "",
    `Clinic (RU): ${clinicNameRu || "-"}`,
    `Clinic (UZ): ${clinicNameUz || "-"}`,
    `Generated:   ${new Date().toISOString()}`,
    "",
    "RUS: В этом архиве зашифрованная копия ваших данных.",
    "     Пароль приходит отдельно: сообщением в Telegram или от сотрудника",
    "     клиники. Распакуйте архив и запустите в его папке:",
    "         bash decrypt.sh",
    "     Скрипт спросит пароль и создаст файл data.json.",
    "     Нужен только openssl: он уже есть в macOS и Linux.",
    "",
    "UZB: Bu arxivda ma'lumotlaringizning shifrlangan nusxasi bor.",
    "     Parol alohida keladi: Telegram xabarida yoki klinika xodimidan.",
    "     Arxivni oching va uning papkasida ishga tushiring:",
    "         bash decrypt.sh",
    "     Skript parolni so'raydi va data.json faylini yaratadi.",
    "     Faqat openssl kerak: u macOS va Linuxda bor.",
    "",
    "ENG: This archive holds an encrypted copy of your data.",
    "     The passphrase comes separately (Telegram or clinic staff).",
    "     Unpack it and run `bash decrypt.sh` in its folder; it asks for the",
    "     passphrase and writes data.json. Requires only openssl.",
    "",
    "Manual decryption (same as decrypt.sh, without the integrity check):",
    `  openssl enc -d -aes-256-cbc -pbkdf2 -iter ${PBKDF2_ITERATIONS} -md sha256 \\`,
    "    -in data.json.enc -out data.json",
    "",
    "Format: openssl enc, AES-256-CBC, PBKDF2-HMAC-SHA256 key and IV,",
    `        ${PBKDF2_ITERATIONS} iterations, 8-byte salt after "Salted__".`,
    "data.json.enc.hmac: HMAC-SHA256 of data.json.enc, keyed with",
    `        HMAC-SHA256(encryption key, "${MAC_INFO}").`,
    "",
  ].join("\n");

  const decryptScript = [
    "#!/usr/bin/env bash",
    "# decrypt.sh: checks and decrypts data.json.enc into data.json.",
    "# Requires: openssl (OpenSSL 1.1.1+, OpenSSL 3 or LibreSSL), od, awk.",
    "set -euo pipefail",
    'cd "$(dirname "$0")"',
    "",
    'IN="data.json.enc"',
    'OUT="data.json"',
    `ITER=${PBKDF2_ITERATIONS}`,
    "",
    'if [ ! -f "$IN" ] || [ ! -f "$IN.hmac" ]; then',
    '  echo "data.json.enc or data.json.enc.hmac is missing: unpack the whole archive first." >&2',
    "  exit 1",
    "fi",
    'if [ -z "${PASSPHRASE:-}" ]; then',
    '  read -r -s -p "Passphrase / Пароль: " PASSPHRASE',
    "  echo",
    "fi",
    "export PASSPHRASE",
    "",
    "# The 8-byte salt right after the «Salted__» magic.",
    'SALT_HEX=$(od -An -tx1 -j8 -N8 "$IN" | tr -d " \\n")',
    "# Key the way openssl enc derives it (-P prints it without encrypting).",
    'KEY_HEX=$(openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -md sha256 \\',
    '  -S "$SALT_HEX" -pass env:PASSPHRASE -P | awk -F= \'tolower($1) ~ /^key/ {gsub(/ /, "", $2); print $2}\')',
    'if [ -z "$KEY_HEX" ]; then',
    '  echo "openssl could not derive the key (it needs -pbkdf2: OpenSSL 1.1.1+ or LibreSSL)." >&2',
    "  exit 1",
    "fi",
    `MAC_KEY=$(printf "%s" "${MAC_INFO}" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$KEY_HEX" | awk '{print $NF}')`,
    'MAC=$(openssl dgst -sha256 -mac HMAC -macopt "hexkey:$MAC_KEY" "$IN" | awk \'{print $NF}\')',
    'EXPECTED=$(tr -d " \\r\\n" < "$IN.hmac")',
    'if [ "$MAC" != "$EXPECTED" ]; then',
    '  echo "Wrong passphrase or damaged archive. / Неверный пароль или архив повреждён." >&2',
    "  exit 1",
    "fi",
    "",
    'openssl enc -d -aes-256-cbc -pbkdf2 -iter "$ITER" -md sha256 \\',
    '  -in "$IN" -out "$OUT" -pass env:PASSPHRASE',
    'echo "Wrote $OUT"',
    "",
  ].join("\n");

  return buildZip([
    { name: "README.txt", body: Buffer.from(readme, "utf8") },
    { name: "data.json.enc", body: ciphertext },
    { name: "data.json.enc.hmac", body: Buffer.from(`${hmacHex}\n`, "utf8") },
    { name: "decrypt.sh", body: Buffer.from(decryptScript, "utf8") },
  ]);
}
