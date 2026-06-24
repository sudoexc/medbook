"use client";

import * as React from "react";

/**
 * Client-side role for CRM UI gating (which tabs/actions render).
 *
 * The role is resolved on the server in `crm/layout.tsx` from the NextAuth
 * session and handed to `CrmRoleProvider`, so every CRM client component sees
 * the real role with no extra round-trip. Server-side gating still lives in
 * `createApiHandler({roles})` — this is purely cosmetic.
 *
 * Components rendered outside a provider (tests, isolated stories) fall back to
 * ADMIN so they show every tab.
 */
export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTIONIST"
  | "NURSE"
  | "CALL_OPERATOR";

const RoleContext = React.createContext<Role | null>(null);

export function CrmRoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  return React.createElement(RoleContext.Provider, { value: role }, children);
}

export function useCurrentRole(): Role {
  return React.useContext(RoleContext) ?? "ADMIN";
}

export function canViewMedical(role: Role): boolean {
  return role !== "RECEPTIONIST" && role !== "CALL_OPERATOR";
}
