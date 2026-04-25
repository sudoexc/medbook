"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import type { TemplateChannel, TemplateCategory } from "./types";

export type Template = {
  id: string;
  key: string;
  nameRu: string;
  nameUz: string;
  channel: TemplateChannel;
  category: TemplateCategory;
  bodyRu: string;
  bodyUz: string;
  buttons: unknown;
  variables: string[];
  trigger: string;
  triggerConfig: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TemplateListResponse = { rows: Template[] };

export function templatesKey() {
  return ["notifications", "templates"] as const;
}

export function useTemplates() {
  return useQuery<TemplateListResponse>({
    queryKey: templatesKey(),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/crm/notifications/templates?limit=200", {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error(`Failed to load templates: ${res.status}`);
      return (await res.json()) as TemplateListResponse;
    },
    staleTime: 30_000,
  });
}

export type TemplateInput = {
  key: string;
  nameRu: string;
  nameUz: string;
  channel: TemplateChannel;
  category: TemplateCategory;
  bodyRu: string;
  bodyUz: string;
  trigger?: string;
  isActive?: boolean;
};

export function useCreateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TemplateInput) => {
      const res = await fetch("/api/crm/notifications/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          trigger: "MANUAL",
          ...input,
        }),
      });
      if (!res.ok) throw new Error(`Create failed: ${res.status}`);
      return (await res.json()) as Template;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey() }),
  });
}

export function useUpdateTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<TemplateInput>;
    }) => {
      const res = await fetch(`/api/crm/notifications/templates/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`Update failed: ${res.status}`);
      return (await res.json()) as Template;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey() }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/crm/notifications/templates/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      return (await res.json()) as { id: string; deleted: boolean };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: templatesKey() }),
  });
}
