/**
 * Server-side receptionist terminal PIN.
 *
 * The PIN MUST be set via the `RECEPTIONIST_PIN` env var. If unset, all PIN
 * checks fail closed — there is no insecure default. The receptionist page
 * itself reads `NEXT_PUBLIC_RECEPTIONIST_PIN` for the client unlock screen,
 * but that value is only a UX gate, not a security boundary.
 */
const PIN = process.env.RECEPTIONIST_PIN;

/**
 * Returns true iff the request carries the correct receptionist PIN header.
 * Constant-time comparison is intentional to defeat timing oracles.
 */
export function hasValidPin(request: Request): boolean {
  if (!PIN) return false;
  const provided = request.headers.get("x-terminal-pin");
  if (!provided || provided.length !== PIN.length) return false;
  let diff = 0;
  for (let i = 0; i < PIN.length; i++) {
    diff |= PIN.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}
