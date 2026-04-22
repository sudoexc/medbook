import "next-auth";
import "next-auth/jwt";

type AppRole =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

declare module "next-auth" {
  interface User {
    role?: AppRole;
    clinicId?: string | null;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: AppRole;
      clinicId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: AppRole;
    clinicId?: string | null;
  }
}
