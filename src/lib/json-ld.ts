/**
 * Safe serialisation for inline `<script type="application/ld+json">` blocks.
 *
 * `JSON.stringify` leaves `<`, `>` and `&` untouched, and the HTML parser
 * ends a script element at the first `</script` it meets, JSON string or
 * not. A value like `Невролог</script><script>…</script>` therefore closes
 * the JSON-LD block and the rest runs as page script on the clinic's own
 * origin (audit LD-02: a doctor could plant it through their profile name
 * and it ran for the admin who opened the public page). Escaping those three
 * characters as JSON unicode escapes keeps the data byte-for-byte identical
 * for crawlers while the HTML parser never sees a tag boundary.
 *
 * U+2028 / U+2029 are escaped as well: legal inside JSON strings but line
 * terminators for older JavaScript parsers, the classic JSON-in-script trap.
 */
export function serializeJsonLd(data: unknown): string {
  // `JSON.stringify(undefined)` is `undefined`; an empty object keeps the
  // script element valid instead of rendering the string "undefined".
  const json = JSON.stringify(data) ?? "{}";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
