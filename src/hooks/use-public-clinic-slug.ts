"use client";

import { useState, useEffect } from "react";
import { DEFAULT_CLINIC_SLUG } from "@/lib/constants";

/**
 * Resolve the clinic slug for the global public surfaces (`/tv`, `/kiosk`).
 * These devices are installed in one clinic, so they default to
 * `DEFAULT_CLINIC_SLUG`; a `?c=<slug>` query param overrides it. Read after
 * mount (not during render) so the prerendered HTML stays slug-stable.
 */
export function usePublicClinicSlug(): string {
  const [slug, setSlug] = useState(DEFAULT_CLINIC_SLUG);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c")?.trim();
    if (c) setSlug(c);
  }, []);
  return slug;
}
