import "next-auth";
import "next-auth/jwt";

type AppRole = "ADMIN" | "DOCTOR" | "RECEPTIONIST";

declare module "next-auth" {
  interface User {
    role?: AppRole;
    doctorId?: string | null;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: AppRole;
      doctorId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    doctorId?: string | null;
  }
}
