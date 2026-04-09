import { auth } from "./auth";
import { hasValidPin } from "./pin";

/**
 * Check authorization: either NextAuth session or X-Terminal-PIN header.
 * Returns true if authorized, false otherwise.
 * Used by queue APIs that the receptionist terminal calls.
 */
export async function isAuthorizedOrPin(request: Request): Promise<boolean> {
  if (hasValidPin(request)) return true;
  const session = await auth();
  return !!session?.user;
}
