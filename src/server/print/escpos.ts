/**
 * A small ESC/POS writer for the clinic's 80mm receipt printer (Xprinter
 * XP-Q80A, Epson command set): text in code page PC866 for Cyrillic, sizes,
 * alignment, a native QR code and the cut. Pure: bytes in, bytes out.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** Columns of Font A on 80mm paper (576 dots / 12). */
export const LINE_WIDTH = 48;

// PC866: А-П 0x80-0x8F, Р-Я 0x90-0x9F, а-п 0xA0-0xAF, р-я 0xE0-0xEF.
function cp866(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if (c < 0x80) return c;
  if (c >= 0x410 && c <= 0x42f) return 0x80 + (c - 0x410);
  if (c >= 0x430 && c <= 0x43f) return 0xa0 + (c - 0x430);
  if (c >= 0x440 && c <= 0x44f) return 0xe0 + (c - 0x440);
  if (c === 0x401) return 0xf0; // Ё
  if (c === 0x451) return 0xf1; // ё
  if (c === 0x2116) return 0xfc; // №
  return null;
}

/** Characters PC866 lacks, as the nearest it has. */
const FALLBACK: Record<string, string> = {
  "«": '"',
  "»": '"',
  "—": "-",
  "–": "-",
  "…": "...",
  "‘": "'",
  "’": "'",
  "ʻ": "'",
  "ʼ": "'",
  "“": '"',
  "”": '"',
  " ": " ",
};

export function encodeCp866(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const direct = cp866(ch);
    if (direct !== null) {
      out.push(direct);
      continue;
    }
    for (const f of FALLBACK[ch] ?? "?") out.push(cp866(f) ?? 0x3f);
  }
  return out;
}

/** Word-wrap to `width` columns; a word longer than a line is cut. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > width) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      lines.push(w.slice(0, width));
      w = w.slice(width);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export class EscPos {
  private bytes: number[] = [];

  constructor(codePage = 17) {
    this.raw(ESC, 0x40); // initialize
    this.raw(ESC, 0x74, codePage); // character code table
  }

  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }

  align(a: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** Character size, 1-8 times wide and high. */
  size(width: number, height: number): this {
    const w = Math.min(8, Math.max(1, width)) - 1;
    const h = Math.min(8, Math.max(1, height)) - 1;
    return this.raw(GS, 0x21, (w << 4) | h);
  }

  text(t: string): this {
    this.bytes.push(...encodeCp866(t));
    return this;
  }

  line(t = ""): this {
    return this.text(t).raw(0x0a);
  }

  /** A label on the left and a value on the right, the value wrapping under. */
  pair(label: string, value: string, width = LINE_WIDTH): this {
    const room = Math.max(8, width - label.length - 1);
    const parts = wrap(value, room);
    parts.forEach((part, i) => {
      const left = i === 0 ? label : "";
      this.line(left + " ".repeat(Math.max(1, width - left.length - part.length)) + part);
    });
    return this;
  }

  rule(width = LINE_WIDTH): this {
    return this.line("-".repeat(width));
  }

  feed(lines: number): this {
    return this.raw(ESC, 0x64, Math.min(255, Math.max(0, lines)));
  }

  /** Native QR (GS ( k): model 2, module size 1-16, error level M. */
  qr(data: string, moduleSize = 7): this {
    const payload = Array.from(Buffer.from(data, "utf8"));
    const len = payload.length + 3;
    this.raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00); // model 2
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, Math.min(16, Math.max(1, moduleSize)));
    this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31); // error correction M
    this.raw(GS, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30, ...payload);
    return this.raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
  }

  /** Feed past the cutter and cut, leaving a hinge. */
  cut(): this {
    return this.raw(GS, 0x56, 66, 3);
  }

  toBuffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}
