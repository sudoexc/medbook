/**
 * Notification text → a body Telegram accepts under `parse_mode: HTML`
 * (audit TG-24).
 *
 * Every notification and broadcast goes out with `parse_mode: HTML`, and the
 * Bot API rejects the whole message («can't parse entities») when a `<`, `>`
 * or `&` is not part of a tag or an entity. `render()` escapes the values it
 * substitutes, but the template and broadcast text staff type was sent raw:
 * «Детям <14 лет бесплатно» or «МРТ & ЭЭГ» failed three times and landed in
 * FAILED for every recipient.
 *
 * Here the text is made safe at the one place every Telegram send passes
 * (the clinic adapter), and the template editor's preview uses the same
 * function, so staff see what the patient sees:
 *   - an entity already in the text (`&lt;` from `render()`, `&#39;`) stays;
 *   - a stray `<`, `>` or `&` is escaped;
 *   - the formatting tags Telegram supports stay formatting, re-emitted
 *     without attributes (a link keeps only an http(s) or tg:// `href`),
 *     but only when every tag is closed and properly nested; otherwise all
 *     of them are shown as typed, since one unclosed `<b>` fails the send.
 *
 * The output is idempotent (a second pass changes nothing) and holds only
 * those tags and entities, so the preview may also render it as HTML.
 * Client-safe: no server imports.
 */

/** Tags Telegram formats, without attributes. */
const SIMPLE_TAGS = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "code",
  "pre",
  "blockquote",
  "tg-spoiler",
]);

/** Entities the Bot API decodes: four named ones and any numeric one. */
const ENTITY_RE = /^&(?:lt|gt|amp|quot|#\d{1,7}|#x[0-9a-fA-F]{1,6});/;
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z-]*)(\s[^<>]*)?>/;
const HREF_RE = /^\s*href\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')\s*$/i;
const SAFE_URL_RE = /^(?:https?:\/\/|tg:\/\/)\S+$/i;

type Token =
  | { kind: "text"; raw: string }
  | { kind: "open"; name: string; href?: string; raw: string }
  | { kind: "close"; name: string; raw: string };

/** `<`, `>` and stray `&` escaped; entities already in place are kept. */
function escapeText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === "&") {
      const m = ENTITY_RE.exec(text.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length - 1;
      } else {
        out += "&amp;";
      }
    } else out += ch;
  }
  return out;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let text = "";
  const flush = () => {
    if (text) tokens.push({ kind: "text", raw: text });
    text = "";
  };
  for (let i = 0; i < input.length; ) {
    if (input[i] === "<") {
      const m = TAG_RE.exec(input.slice(i));
      if (m) {
        const closing = m[1] === "/";
        const name = m[2]!.toLowerCase();
        const attrs = m[3] ?? "";
        let token: Token | null = null;
        if (SIMPLE_TAGS.has(name) && attrs.trim() === "") {
          token = closing
            ? { kind: "close", name, raw: m[0] }
            : { kind: "open", name, raw: m[0] };
        } else if (name === "a") {
          if (closing && attrs.trim() === "") {
            token = { kind: "close", name, raw: m[0] };
          } else if (!closing) {
            const href = HREF_RE.exec(attrs);
            const url = href ? (href[1] ?? href[2] ?? "").trim() : "";
            if (SAFE_URL_RE.test(url)) {
              token = { kind: "open", name, href: url, raw: m[0] };
            }
          }
        }
        if (token) {
          flush();
          tokens.push(token);
          i += m[0].length;
          continue;
        }
      }
    }
    text += input[i];
    i += 1;
  }
  flush();
  return tokens;
}

/**
 * Whether the tags close in order and nest the way Telegram allows: nothing
 * inside `code`, only `code` inside `pre`, no link inside a link.
 */
function wellFormed(tokens: Token[]): boolean {
  const stack: string[] = [];
  for (const t of tokens) {
    if (t.kind === "open") {
      const top = stack[stack.length - 1];
      if (top === "code") return false;
      if (top === "pre" && t.name !== "code") return false;
      if (t.name === "a" && stack.includes("a")) return false;
      stack.push(t.name);
    } else if (t.kind === "close") {
      if (stack.pop() !== t.name) return false;
    }
  }
  return stack.length === 0;
}

export function toTelegramHtml(input: string): string {
  if (!input) return "";
  const tokens = tokenize(input);
  const keepTags = wellFormed(tokens);
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text" || !keepTags) {
      out += escapeText(t.raw);
    } else if (t.kind === "open") {
      out +=
        t.name === "a"
          ? `<a href="${escapeText(t.href ?? "").replace(/"/g, "&quot;")}">`
          : `<${t.name}>`;
    } else {
      out += `</${t.name}>`;
    }
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Telegram HTML (what the notification worker sends) to the plain text the
 * chat bubble shows: line breaks kept, tags dropped, entities decoded.
 */
export function telegramHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1] === "x" || code[1] === "X"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        // Past U+10FFFF `fromCodePoint` throws: keep such an entity as typed.
        return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .trim();
}

/**
 * A stored notification body (`render()` output: substituted values are
 * HTML-escaped, the typed text is not) as the plain text the patient reads
 * in Telegram (audit G6-25). Staff screens printed it as is, so «G'ulom»
 * showed as «G&#39;ulom». The same HTML pass as the sender first, so a typed
 * «<14 лет» survives and only real formatting tags are dropped.
 */
export function notificationBodyText(body: string | null | undefined): string {
  if (!body) return "";
  return telegramHtmlToText(toTelegramHtml(body));
}
