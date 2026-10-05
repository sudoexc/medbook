"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  isHeicFile,
  uploadInTurn,
  type DevTaskAttachmentDto,
  type DevTaskDetailDto,
  type DevTaskListDto,
  type DevTaskPriority,
  type DevTaskStatus,
} from "@/lib/dev-tasks";

import { devTaskKey, devTasksBoardKey, devTasksKey } from "./query-keys";
import { heicAsJpeg, makeScreenshotThumb } from "./screenshot-thumb";

/**
 * Data hooks of the «Задачи» board, shared by /crm/tasks and /doctor/tasks.
 *
 * No SSE here on purpose: tasks change a few times a day, so the board and
 * the open task refetch when the tab comes back into focus and every 30 s,
 * which is live enough for «the developer took my task» without adding
 * event types to the realtime bus.
 */
const LIVE = {
  refetchInterval: 30_000,
  refetchOnWindowFocus: true,
  staleTime: 10_000,
} as const;

/** A failed call with the HTTP status and the API's `reason`, for messages. */
export class DevTaskApiError extends Error {
  constructor(
    public status: number,
    public reason: string | null,
  ) {
    super(`HTTP ${status}${reason ? ` ${reason}` : ""}`);
    this.name = "DevTaskApiError";
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    let reason: string | null = null;
    try {
      const body = (await res.json()) as { reason?: string; error?: string };
      reason = body.reason ?? body.error ?? null;
    } catch {
      /* not JSON */
    }
    throw new DevTaskApiError(res.status, reason);
  }
  return (await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function useDevTaskBoard(includeCancelled: boolean) {
  return useQuery<DevTaskListDto, DevTaskApiError>({
    queryKey: devTasksBoardKey(includeCancelled),
    queryFn: ({ signal }) =>
      call<DevTaskListDto>(
        `/api/crm/dev-tasks${includeCancelled ? "?includeCancelled=1" : ""}`,
        { signal },
      ),
    ...LIVE,
  });
}

/** One task by id or «12»; idle while `ref` is null (drawer closed). */
export function useDevTask(ref: string | null) {
  return useQuery<DevTaskDetailDto, DevTaskApiError>({
    queryKey: devTaskKey(ref ?? ""),
    queryFn: ({ signal }) =>
      call<DevTaskDetailDto>(`/api/crm/dev-tasks/${encodeURIComponent(ref ?? "")}`, {
        signal,
      }),
    enabled: Boolean(ref),
    retry: (count, error) => error.status !== 404 && count < 1,
    ...LIVE,
  });
}

/** Board, open task and badge all redraw after any change. */
function useRefreshAll() {
  const qc = useQueryClient();
  return (detail?: DevTaskDetailDto) => {
    if (detail) {
      qc.setQueryData(devTaskKey(detail.id), detail);
      qc.setQueryData(devTaskKey(String(detail.number)), detail);
    }
    void qc.invalidateQueries({ queryKey: devTasksKey });
  };
}

export function useCreateDevTask() {
  const refresh = useRefreshAll();
  return useMutation<
    DevTaskDetailDto,
    DevTaskApiError,
    { title: string; description: string; priority: DevTaskPriority }
  >({
    mutationFn: (body) => call<DevTaskDetailDto>("/api/crm/dev-tasks", json("POST", body)),
    onSuccess: (detail) => refresh(detail),
  });
}

export function useUpdateDevTask() {
  const refresh = useRefreshAll();
  return useMutation<
    DevTaskDetailDto,
    DevTaskApiError,
    {
      id: string;
      title?: string;
      description?: string;
      priority?: DevTaskPriority;
      status?: DevTaskStatus;
    }
  >({
    mutationFn: ({ id, ...patch }) =>
      call<DevTaskDetailDto>(`/api/crm/dev-tasks/${encodeURIComponent(id)}`, json("PATCH", patch)),
    onSuccess: (detail) => refresh(detail),
    // A 409 means someone moved it meanwhile: show the real state.
    onError: () => refresh(),
  });
}

export function useAddDevTaskComment() {
  const refresh = useRefreshAll();
  return useMutation<DevTaskDetailDto, DevTaskApiError, { id: string; text: string }>({
    mutationFn: ({ id, text }) =>
      call<DevTaskDetailDto>(
        `/api/crm/dev-tasks/${encodeURIComponent(id)}/comments`,
        json("POST", { text }),
      ),
    onSuccess: (detail) => refresh(detail),
  });
}

/**
 * One screenshot, with the small preview the board cards show. A HEIC goes
 * up as a JPEG when this browser can redraw it (`heicAsJpeg`), so Chrome can
 * show it later. The preview is best effort: a format the browser cannot
 * draw (HEIC in Chrome) goes up without one.
 */
export async function uploadDevTaskScreenshot(
  taskId: string,
  picked: File,
): Promise<DevTaskAttachmentDto> {
  const file = isHeicFile(picked) ? ((await heicAsJpeg(picked)) ?? picked) : picked;
  const form = new FormData();
  form.append("file", file, file.name || "screenshot");
  const thumb = await makeScreenshotThumb(file);
  if (thumb) form.append("thumb", thumb, "thumb.jpg");
  // No Content-Type header: the browser sets the multipart boundary itself.
  return call<DevTaskAttachmentDto>(
    `/api/crm/dev-tasks/${encodeURIComponent(taskId)}/attachments`,
    { method: "POST", body: form },
  );
}

export function useUploadDevTaskScreenshots() {
  const refresh = useRefreshAll();
  return useMutation<
    { uploaded: number; failed: number; failedFiles: File[] },
    DevTaskApiError,
    { taskId: string; files: File[]; onProgress?: (done: number) => void }
  >({
    mutationFn: async ({ taskId, files, onProgress }) => {
      // One at a time (`uploadInTurn`); the files that failed come back so
      // the caller can offer them again.
      const result = await uploadInTurn(
        files,
        (file) => uploadDevTaskScreenshot(taskId, file),
        onProgress,
      );
      return {
        uploaded: result.uploaded.length,
        failed: result.failed.length,
        failedFiles: result.failed,
      };
    },
    onSettled: () => refresh(),
  });
}

export function useRemoveDevTaskScreenshot() {
  const refresh = useRefreshAll();
  return useMutation<unknown, DevTaskApiError, { taskId: string; attachmentId: string }>({
    mutationFn: ({ taskId, attachmentId }) =>
      call(
        `/api/crm/dev-tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: "DELETE" },
      ),
    onSettled: () => refresh(),
  });
}
