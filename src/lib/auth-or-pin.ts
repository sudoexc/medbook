import { auth } from "./auth";

const RECEPTIONIST_PIN = process.env.RECEPTIONIST_PIN || "8868";

/**
 * Check authorization: either NextAuth session or X-Terminal-PIN header.
 * Returns true if authorized, false otherwise.
 * Used by queue APIs that the receptionist terminal calls.
 */
export async function isAuthorizedOrPin(request: Request): Promise<boolean> {
  // Check PIN header first (fast path for receptionist terminal)
  const pin = request.headers.get("x-terminal-pin");
  if (pin === RECEPTIONIST_PIN) return true;

  // Fall back to NextAuth session
  const session = await auth();
  return !!session?.user;
}
