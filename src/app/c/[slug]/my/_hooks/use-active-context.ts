"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Active "on behalf of" patient context.
 *
 * Stored in the URL as `?onBehalfOf=<patientId>`. Empty / absent means
 * "act as self" (the TG-linked owner). URL-based instead of localStorage so:
 *   - Mini App home reload preserves the active relative.
 *   - Booking flow sees the same value via `useSearchParams`.
 *   - A "back" navigation reverts the context naturally.
 *
 * The booking POST forwards this value to the API so the appointment is
 * created against the relative's `patientId`. The owner remains the TG
 * actor in audit / notifications.
 */
export function useActiveContext() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const onBehalfOf = params.get("onBehalfOf") || null;

  const setOnBehalfOf = React.useCallback(
    (patientId: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (patientId) next.set("onBehalfOf", patientId);
      else next.delete("onBehalfOf");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname, router],
  );

  return { onBehalfOf, setOnBehalfOf };
}
