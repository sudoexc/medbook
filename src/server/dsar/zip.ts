/**
 * Phase 17 Wave 3 — DSAR encrypted-bundle packaging.
 *
 * Produces a self-describing `.zip` containing:
 *   • README.txt          — human-readable decryption instructions (RU+UZ).
 *   • data.json.enc       — AES-256-GCM ciphertext of the JSON bundle.
 *   • decrypt.sh          — reference shell script that decrypts using
 *                           the passphrase + an openssl command. The
 *                           patient is meant to run this locally.
 *
 * Why not standard ZIP encryption? Implementing PKZIP password-encrypted
 * entries (or AES-256 ZipCrypto) by hand is a maintenance trap — wrong
 * key derivation, wrong tag length, every ZIP tool decodes it slightly
 * differently. We instead emit a plain ZIP container with one
 * encrypted-blob entry; the patient extracts the blob normally and
 * decrypts it with a documented openssl recipe. The bundle README
 * spells out the exact command.
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

import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
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

/**
 * Encrypt a UTF-8 plaintext string with AES-256-GCM.
 *
 * Layout of the returned Buffer:
 *   bytes 0..15   — 16-byte salt (scrypt input alongside the passphrase)
 *   bytes 16..27  — 12-byte IV
 *   bytes 28..43  — 16-byte auth tag
 *   bytes 44..    — ciphertext
 *
 * The decrypt.sh script in the bundle pulls these slices and runs
 * `openssl enc -d -aes-256-gcm` after deriving the key with scrypt.
 */
export function encryptBundle(
  plaintext: string,
  passphrase: string,
): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  // scrypt — N=16384 (2^14) is the safe-but-quick default; 32 byte key.
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, ciphertext]);
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
  const cipher = encryptBundle(bundleJson, passphrase);

  const readme = [
    "MedBook — Personal data export bundle",
    "",
    `Clinic (RU): ${clinicNameRu || "—"}`,
    `Clinic (UZ): ${clinicNameUz || "—"}`,
    `Generated:   ${new Date().toISOString()}`,
    "",
    "RUS: В этом архиве находится зашифрованная копия ваших данных.",
    "     Используйте пароль, который мы прислали отдельным сообщением",
    "     в Telegram. Запустите decrypt.sh (требуется openssl).",
    "",
    "UZB: Bu arxivda ma'lumotlaringizning shifrlangan nusxasi mavjud.",
    "     Telegram orqali alohida xabarda yuborilgan parolni ishlating.",
    "     decrypt.sh skriptini ishga tushiring (openssl talab qilinadi).",
    "",
    "ENG: This archive contains an AES-256-GCM encrypted copy of your data.",
    "     Use the passphrase delivered in a separate Telegram message.",
    "     Run decrypt.sh (requires openssl) to produce data.json.",
    "",
    "Layout of data.json.enc:",
    "  bytes 0..15   = 16-byte scrypt salt",
    "  bytes 16..27  = 12-byte AES-GCM IV",
    "  bytes 28..43  = 16-byte AES-GCM auth tag",
    "  bytes 44..    = ciphertext",
    "",
    "Key derivation: scrypt(passphrase, salt, N=16384, r=8, p=1, dklen=32)",
    "Cipher:         AES-256-GCM",
    "",
  ].join("\n");

  const decryptScript = [
    "#!/usr/bin/env bash",
    "# decrypt.sh — DSAR bundle decryptor.",
    "# Requires: openssl, xxd, dd.",
    "set -euo pipefail",
    "",
    'if [ -z "${PASSPHRASE:-}" ]; then',
    '  read -srp "Enter passphrase: " PASSPHRASE',
    '  echo',
    'fi',
    "",
    'IN="data.json.enc"',
    'OUT="data.json"',
    "",
    'SALT_HEX=$(dd if="$IN" bs=1 count=16 2>/dev/null | xxd -p -c 32)',
    'IV_HEX=$(dd if="$IN" bs=1 skip=16 count=12 2>/dev/null | xxd -p -c 32)',
    'TAG_HEX=$(dd if="$IN" bs=1 skip=28 count=16 2>/dev/null | xxd -p -c 32)',
    'KEY_HEX=$(printf "%s" "$PASSPHRASE" | openssl kdf -keylen 32 \\',
    '  -kdfopt digest:SHA256 \\',
    '  -kdfopt N:16384 -kdfopt r:8 -kdfopt p:1 \\',
    '  -kdfopt salt:"$(printf %s "$SALT_HEX" | xxd -r -p)" \\',
    '  -kdfopt pass:"$PASSPHRASE" SCRYPT 2>/dev/null \\',
    '  | tr -d ":\\n " || true)',
    "",
    'dd if="$IN" bs=1 skip=44 2>/dev/null > /tmp/dsar.ct',
    'openssl enc -d -aes-256-gcm \\',
    '  -K "$KEY_HEX" \\',
    '  -iv "$IV_HEX" \\',
    '  -in /tmp/dsar.ct \\',
    '  -out "$OUT" \\',
    '  -tag "$TAG_HEX" || {',
    '    echo "Decryption failed — wrong passphrase?" >&2',
    '    rm -f /tmp/dsar.ct "$OUT"',
    '    exit 1',
    '  }',
    'rm -f /tmp/dsar.ct',
    'echo "Wrote $OUT"',
    "",
  ].join("\n");

  return buildZip([
    { name: "README.txt", body: Buffer.from(readme, "utf8") },
    { name: "data.json.enc", body: cipher },
    { name: "decrypt.sh", body: Buffer.from(decryptScript, "utf8") },
  ]);
}
