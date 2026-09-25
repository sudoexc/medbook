/**
 * NextAuth catch-all route.
 *
 * Brute-force protection lives on the credentials callback only, and counts
 * FAILED password checks per real client IP and per email (see
 * `src/server/auth/login-throttle.ts`, audit SEC-02 / SEC-03). It used to be a
 * flat "5 POSTs a minute per X-Forwarded-For value" on every POST under
 * /api/auth, which:
 *   - a script bypassed by writing a new X-Forwarded-For on every request;
 *   - locked out the sixth colleague signing in from the clinic's single
 *     office IP within a minute (successful logins spent the budget too);
 *   - could answer 429 to «Выйти»: next-auth then sent the user to /login
 *     without clearing the session cookie, so the next person at a shared
 *     reception PC opened /crm under the previous user's account.
 * Sign-out, CSRF and session refreshes are never throttled now.
 */
import type { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { realClientIp } from "@/lib/client-ip";
import {
  checkLoginThrottle,
  tooManyAttemptsResponse,
} from "@/server/auth/login-throttle";

export const { GET } = handlers;

function isCredentialsCallback(pathname: string): boolean {
  return /\/api\/auth\/callback\/credentials\/?$/.test(pathname);
}

/** The email being tried, read from a clone so NextAuth still gets the body. */
async function peekEmail(request: NextRequest): Promise<string | null> {
  try {
    const form = await request.clone().formData();
    const email = form.get("email");
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (isCredentialsCallback(request.nextUrl.pathname)) {
    const status = checkLoginThrottle({
      ip: realClientIp(request),
      email: await peekEmail(request),
    });
    if (status.blocked) {
      // next-auth/react's signIn() reads `url` from the JSON body and parses
      // `error` out of it; without a url it throws and the login button
      // stays stuck on «Входим…». Give it one it can parse.
      const url = new URL("/login", request.nextUrl.origin);
      url.searchParams.set("error", "RateLimited");
      return tooManyAttemptsResponse(status, { url: url.toString() });
    }
  }
  return handlers.POST(request);
}
