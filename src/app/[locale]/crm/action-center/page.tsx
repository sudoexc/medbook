import * as React from "react";

import { auth } from "@/lib/auth";

import { ActionCenterClient } from "./_components/action-center-client";

/**
 * `/crm/action-center` — Phase 13 Wave 3 surface. TZ §13.4.
 *
 * Thin server shell that resolves the caller's role once and forwards it to
 * the client. Role gating in the UI (recompute, reopen, assignee filter) is
 * cosmetic — the underlying mutation routes enforce the same gate server-side
 * via `createApiHandler`. Doing the resolve here lets the client render the
 * right buttons without a second round trip.
 */
export default async function ActionCenterPage() {
  const session = await auth();
  const role = session?.user?.role ?? null;
  return <ActionCenterClient role={role} />;
}
