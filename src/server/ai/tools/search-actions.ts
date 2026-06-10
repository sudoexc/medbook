/**
 * Phase 15 Wave 3 — `searchActions` tool.
 *
 * READ-ONLY. Surfaces rows from the Phase 13 Action Center, filtered by
 * severity / type / status. Defaults to OPEN actions (the receptionist's
 * inbox). Up to 10 rows, each with a `/crm/action-center?focus={id}` deeplink.
 *
 * The chip label uses the action type as a short label — i18n for action
 * type labels lives under `actions.types.<TYPE>.label` in the messages, but
 * we're outside the React tree here so we just pass the type code; the UI
 * component consuming chips can translate it on render. To keep the tool
 * self-contained we use a tiny RU/UZ map for the most common types.
 */

import { prisma } from "@/lib/prisma";
import {
  ACTION_TYPES,
  ACTION_SEVERITIES,
  type ActionSeverity,
  type ActionType,
} from "@/lib/actions/types";
import type { Tool, ToolContext, ToolResult } from "./types";

type SearchActionsInput = {
  severity?: ActionSeverity;
  type?: ActionType;
  status?: "OPEN" | "SNOOZED" | "DISMISSED" | "DONE";
};

const MAX_RESULTS = 10;

const TYPE_LABEL_RU: Record<ActionType, string> = {
  EMPTY_SLOT_TOMORROW: "Пустое окно завтра",
  DORMANT_BATCH: "Дормантные пациенты",
  UNCONFIRMED_24H: "Не подтверждено за 24ч",
  NO_SHOW_RISK_HIGH: "Риск no-show",
  CASE_REPEAT_DUE: "Повтор по случаю",
  OVERDUE_FOLLOW_UP: "Просрочен follow-up",
  DOCTOR_OVERLOAD: "Перегрузка врача",
  IDLE_ROOM: "Простой кабинета",
  PAYMENT_OVERDUE: "Просрочена оплата",
  LOW_DOCTOR_SCHEDULE: "Мало слотов у врача",
  LOW_NPS_RECEIVED: "Низкая оценка визита",
  PATIENT_NO_CHANNEL: "Нет канала связи",
  VISIT_FOLLOW_UP_DUE: "Пора на контрольный визит",
};

const TYPE_LABEL_UZ: Record<ActionType, string> = {
  EMPTY_SLOT_TOMORROW: "Ertaga bo'sh oyna",
  DORMANT_BATCH: "Faolsiz bemorlar",
  UNCONFIRMED_24H: "24 soatda tasdiqlanmagan",
  NO_SHOW_RISK_HIGH: "No-show xavfi",
  CASE_REPEAT_DUE: "Holat takrori",
  OVERDUE_FOLLOW_UP: "Kechiktirilgan follow-up",
  DOCTOR_OVERLOAD: "Shifokor yuklamasi",
  IDLE_ROOM: "Bo'sh kabinet",
  PAYMENT_OVERDUE: "Kechiktirilgan to'lov",
  LOW_DOCTOR_SCHEDULE: "Slotlar kam",
  LOW_NPS_RECEIVED: "Past tashrif bahosi",
  PATIENT_NO_CHANNEL: "Aloqa kanali yo'q",
  VISIT_FOLLOW_UP_DUE: "Nazorat tashrifi vaqti keldi",
};

export const searchActionsTool: Tool<SearchActionsInput> = {
  name: "searchActions",
  description:
    "Search the Action Center for open / snoozed / dismissed / done actions, optionally filtered by severity or action type. Use when the user asks 'show critical actions', 'no-show risks today', or similar. Returns up to 10 actions.",
  input_schema: {
    type: "object",
    properties: {
      severity: {
        type: "string",
        enum: [...ACTION_SEVERITIES],
        description: "Severity filter: low | medium | high | critical.",
      },
      type: {
        type: "string",
        enum: [...ACTION_TYPES],
        description:
          "Action type filter (e.g. NO_SHOW_RISK_HIGH, EMPTY_SLOT_TOMORROW).",
      },
      status: {
        type: "string",
        enum: ["OPEN", "SNOOZED", "DISMISSED", "DONE"],
        description: "Status filter. Defaults to OPEN.",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    input: SearchActionsInput,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const status = input.status ?? "OPEN";

    const rows = await prisma.action.findMany({
      where: {
        clinicId: context.clinicId,
        status,
        ...(input.severity ? { severity: input.severity } : {}),
        ...(input.type ? { type: input.type } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: MAX_RESULTS,
      select: {
        id: true,
        type: true,
        severity: true,
        payload: true,
        deeplinkPath: true,
      },
    });

    const labels = context.locale === "uz" ? TYPE_LABEL_UZ : TYPE_LABEL_RU;

    const data = rows.map((r) => {
      const t = r.type as ActionType;
      const title = labels[t] ?? r.type;
      return {
        actionId: r.id,
        type: r.type,
        severity: r.severity,
        title,
        deeplink: `/crm/action-center?focus=${r.id}`,
      };
    });

    const summary =
      data.length === 0
        ? context.locale === "ru"
          ? "Подходящих действий в Action Center не найдено."
          : "Action Center'da mos actionlar topilmadi."
        : context.locale === "ru"
          ? `Найдено ${data.length} действий. Самое срочное: ${data[0]!.title} (${data[0]!.severity}).`
          : `${data.length} ta action topildi. Eng tezkori: ${data[0]!.title} (${data[0]!.severity}).`;

    return {
      ok: true,
      data: { actions: data },
      summary,
      chips: data.map((a) => ({
        kind: "action" as const,
        label: a.title,
        deeplink: a.deeplink,
      })),
    };
  },
};
