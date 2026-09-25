/**
 * The caller's address, as our own proxy saw it (audit SEC-01 / SEC-03).
 *
 * nginx sets `X-Real-IP` from the TCP peer (`$remote_addr`) and APPENDS the
 * peer to `X-Forwarded-For` (`$proxy_add_x_forwarded_for`). The first XFF
 * entry is therefore whatever the client chose to write: a rate limit keyed on
 * it is bypassed by changing a header, and an audit row that records it can be
 * forged. Everything that buckets or records a client IP goes through here.
 *
 * Lives in `lib/` (not in the kiosk module where it was born) so the audit
 * helpers and the auth routes can use it without importing kiosk code;
 * `@/server/kiosk/device` re-exports it for the existing call sites.
 */

type HasHeaders = { headers: { get(name: string): string | null } };

export function realClientIp(request: HasHeaders): string {
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    // The right-most hop is the one our proxy appended.
    if (parts.length > 0) return parts[parts.length - 1]!;
  }
  return "unknown";
}

/** Same address for an AuditLog row, where "no address" is stored as null. */
export function clientIpForAudit(request: HasHeaders): string | null {
  const ip = realClientIp(request);
  return ip === "unknown" ? null : ip;
}

/**
 * The unit a per-address limit counts: an IPv4 address as is, an IPv6 address
 * by its /64. One IPv6 customer (a home router, a rented server) is handed a
 * whole /64, 2^64 addresses, so a limit keyed on the full address is reset by
 * picking the next one. Anything that is not an IP address (`unknown`) comes
 * back unchanged.
 */
export function ipBucket(ip: string): string {
  const raw = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  if (mapped) return mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(raw)) return raw;
  const groups = ipv6Groups(raw.split("%")[0]!);
  if (!groups) return raw;
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function ipv6Groups(addr: string): number[] | null {
  if (!addr.includes(":")) return null;
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    const pieces = part.split(":");
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i]!;
      // An embedded IPv4 tail (64:ff9b::192.0.2.1) fills the last 32 bits.
      if (i === pieces.length - 1 && p.includes(".")) {
        const octets = p.split(".").map(Number);
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
      out.push(parseInt(p, 16));
    }
    return out;
  };
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}
