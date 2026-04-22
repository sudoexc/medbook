"use client";

/**
 * Small fetch helpers for the settings UI. Centralising the error-shape so
 * every mutation surface can match on `reason` strings from the API.
 */

export class SettingsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly reason?: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export async function settingsFetch<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const errPayload =
      parsed && typeof parsed === "object"
        ? (parsed as { error?: string; reason?: string })
        : {};
    throw new SettingsApiError(
      errPayload.error || `HTTP ${res.status}`,
      res.status,
      errPayload.reason,
      parsed,
    );
  }
  return parsed as T;
}
