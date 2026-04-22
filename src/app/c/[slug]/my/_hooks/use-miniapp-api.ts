"use client";

import {
  miniAppFetchHeaders,
  useMiniAppAuth,
} from "../_components/miniapp-auth-provider";

/**
 * Build a fetch helper that automatically appends `clinicSlug` and the TG
 * init-data header. Returns a typed `request` function the hooks use.
 */
export function useMiniAppFetch() {
  const { clinicSlug, initData, isTelegramContext } = useMiniAppAuth();
  async function request<T>(
    path: string,
    init: RequestInit & { searchParams?: Record<string, string | string[] | undefined> } = {},
  ): Promise<T> {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("clinicSlug", clinicSlug);
    if (init.searchParams) {
      for (const [k, v] of Object.entries(init.searchParams)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v)) {
          url.searchParams.delete(k);
          for (const item of v) url.searchParams.append(k, item);
        } else {
          url.searchParams.set(k, v);
        }
      }
    }
    const res = await fetch(url.toString(), {
      ...init,
      headers: {
        ...miniAppFetchHeaders(initData, isTelegramContext),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : null;
    if (!res.ok) {
      const message = body?.reason ?? body?.error ?? `HTTP ${res.status}`;
      const error = new Error(message) as Error & {
        status?: number;
        data?: unknown;
      };
      error.status = res.status;
      error.data = body;
      throw error;
    }
    return body as T;
  }
  return { request, clinicSlug };
}
