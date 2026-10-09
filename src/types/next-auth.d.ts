import "next-auth";
import "next-auth/jwt";

import type { StartPage } from "@/lib/start-page";

type AppRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

type ImpersonationSessionStamp = {
  grantId: string;
  mode: "WRITE" | "VIEW_ONLY";
  /** ISO end of the current lease: the banner's countdown (owner request
   *  09.10.2026). Null only for a JWT minted before the claim existed. */
  expiresAt?: string | null;
  /** ISO latest end «Продлить» can reach (8 h from the grant's start). */
  maxExpiresAt?: string | null;
} | null;

declare module "next-auth" {
  interface User {
    role?: AppRole;
    clinicId?: string | null;
    mustChangePassword?: boolean;
    preferredLocale?: string;
    /** Raw `User.startPage`; the jwt callback keeps only a value that applies. */
    startPage?: string | null;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: AppRole;
      clinicId: string | null;
      mustChangePassword: boolean;
      // Phase 19 Wave 4 — populated when the SUPER_ADMIN has an active
      // impersonation grant. Layouts read this to flip the banner colour
      // and the API wrapper consults `mode === "VIEW_ONLY"` to reject
      // mutations.
      impersonation?: ImpersonationSessionStamp;
      // The server-side UserSession row this browser is bound to (null for
      // sessions minted before JWTs carried it). Not a secret: it only
      // matters together with the encrypted JWT that names it.
      sessionId?: string | null;
      // Epoch ms of a sign-in made with an admin-issued temporary password,
      // null otherwise. Lets that fresh session set a new password without
      // re-typing the temporary one, for a short window only.
      tempPasswordLoginAt?: number | null;
      // The account's start page (src/lib/start-page.ts), present only when
      // one applies to it: the login forms send the user there and the proxy
      // reroutes the bare CRM entry to it. Absent for everyone else, so their
      // session payload is unchanged.
      startPage?: StartPage;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: AppRole;
    clinicId?: string | null;
    mustChangePassword?: boolean;
    impersonationGrantId?: string | null;
    impersonationMode?: "WRITE" | "VIEW_ONLY" | null;
    /** Epoch ms end of the live grant's lease, re-read on every refresh. */
    impersonationExpiresAt?: number | null;
    /** Epoch ms cap of that lease (8 h from the grant's start). */
    impersonationMaxExpiresAt?: number | null;
    /** UserSession row id minted at sign-in (see session-guard.ts). */
    sid?: string | null;
    /** Minting the UserSession row failed at sign-in: skip the row binding. */
    sidUnbound?: boolean;
    /** Epoch ms of a sign-in made with a temporary password. */
    pwTempAt?: number | null;
    /** The account's start page, set only when one applies. */
    startPage?: StartPage;
  }
}
