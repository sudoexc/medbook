import "next-auth";
import "next-auth/jwt";

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
} | null;

declare module "next-auth" {
  interface User {
    role?: AppRole;
    clinicId?: string | null;
    mustChangePassword?: boolean;
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
  }
}
