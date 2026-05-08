/**
 * Phase 15 Wave 3 — NL Command Bar tool-calling loop.
 *
 * `askAssistant({ clinicId, userId, locale, question })` runs the
 * Anthropic-style tool_use loop:
 *
 *   1. Send the user's question + tool descriptors to the LLM proxy.
 *   2. If the proxy returns `toolCalls`, execute each via the registry.
 *   3. Feed the tool results back as user-content of the next turn and call
 *      the LLM again.
 *   4. Repeat up to `MAX_ITERATIONS` (4). When the LLM finally returns text
 *      with no tool calls, that's our final answer.
 *   5. Aggregate `chips` from every tool result and return them with the
 *      answer.
 *
 * READ-ONLY: the registry only exposes lookup tools. There is NO branch in
 * this loop that ever mutates state. If you're tempted to add one — don't;
 * Wave 3 is explicitly read-only and the rest of the product depends on
 * that contract.
 *
 * Token / cost accounting: we sum the per-call values from `LLMResponse` so
 * the API endpoint can audit & display the total spend of the whole
 * exchange, not just the last hop.
 */

import { callLLM, type LLMResponse } from "./llm";
import {
  executeTool,
  getToolDescriptors,
  UnknownToolError,
} from "./tools";
import type { Chip, ToolContext } from "./tools";

export type AskAssistantInput = {
  clinicId: string;
  userId: string;
  locale: "ru" | "uz";
  question: string;
};

export type ToolTraceEntry = {
  name: string;
  input: unknown;
  ok: boolean;
};

export type AskAssistantResult = {
  answer: string;
  chips: Chip[];
  toolTrace: ToolTraceEntry[];
  inputTokens: number;
  outputTokens: number;
  costUzs: number;
};

const MAX_ITERATIONS = 4;

function systemPrompt(locale: "ru" | "uz"): string {
  if (locale === "ru") {
    return [
      "Ты — AI-ассистент медицинской CRM-клиники.",
      "Используй tools чтобы отвечать на вопросы пользователя точно — не выдумывай данные о пациентах, врачах или приёмах, всегда сверяйся через tool-вызов.",
      "Возвращай финальный ответ кратко (1-3 предложения) на русском языке.",
      "Если данных недостаточно — честно скажи об этом.",
      "ВАЖНО: ты только READ-ONLY ассистент. Никогда не предлагай действия, требующие записи в БД (создать запись, отменить приём, изменить статус). Если пользователь просит что-то сделать — отвечай 'нужно открыть соответствующую страницу и сделать действие вручную'.",
    ].join(" ");
  }
  return [
    "Sen — klinika CRM uchun AI yordamchisi.",
    "Foydalanuvchi savollariga javob berish uchun tool'lardan foydalan — bemorlar, shifokorlar yoki uchrashuvlar haqida ma'lumot to'qima, har doim tool orqali tekshir.",
    "Yakuniy javobni qisqa (1-3 jumla) o'zbek tilida (lotin yozuvida) qaytar.",
    "Agar ma'lumot yetmasa — ochiq ayt.",
    "MUHIM: sen faqat READ-ONLY yordamchisan. Ma'lumotlar bazasini o'zgartiruvchi amallarni (yozuv yaratish, bekor qilish, status o'zgartirish) hech qachon taklif qilma. Foydalanuvchi biror amalni so'rasa — 'tegishli sahifani ochib qo'lda bajarish kerak' deb javob ber.",
  ].join(" ");
}

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

/**
 * Render a list of tool results into a single user-content message that
 * mimics the Anthropic tool_result block shape. We don't have full content-
 * block plumbing through the proxy yet, so we collapse to text:
 *   "[tool:findFreeSlots ok=true] {summary}\n[tool:findPatient ok=false] err: ..."
 * The LLM treats this as ground truth for the next iteration.
 */
function renderToolResults(
  results: Array<{ name: string; ok: boolean; summary: string }>,
): string {
  return results
    .map(
      (r) =>
        `[tool:${r.name} ok=${r.ok}] ${r.summary || "(no summary)"}`,
    )
    .join("\n");
}

export async function askAssistant(
  input: AskAssistantInput,
): Promise<AskAssistantResult> {
  const ctx: ToolContext = {
    clinicId: input.clinicId,
    userId: input.userId,
    locale: input.locale,
  };

  const messages: ConversationTurn[] = [
    { role: "user", content: input.question },
  ];
  const toolTrace: ToolTraceEntry[] = [];
  const chips: Chip[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUzs = 0;
  let lastText = "";

  const tools = getToolDescriptors();

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const resp: LLMResponse = await callLLM({
      clinicId: input.clinicId,
      userId: input.userId,
      useCase: "cmdk.search",
      system: systemPrompt(input.locale),
      messages,
      tools,
      temperature: 0.2,
      maxTokens: 1024,
      knownNames: [],
    });

    inputTokens += resp.inputTokens;
    outputTokens += resp.outputTokens;
    costUzs += resp.costUzs;
    if (resp.text) lastText = resp.text;

    const calls = resp.toolCalls ?? [];
    if (calls.length === 0) {
      // Terminal: the LLM produced text with no further tool requests.
      return {
        answer: resp.text || lastText || fallbackAnswer(input.locale),
        chips,
        toolTrace,
        inputTokens,
        outputTokens,
        costUzs,
      };
    }

    // Execute each tool sequentially (concurrency would add complexity
    // for ~no payoff — typical exchange has 1-2 tools).
    const stepResults: Array<{ name: string; ok: boolean; summary: string }> =
      [];
    for (const call of calls) {
      let ok = false;
      let summary = "";
      try {
        const result = await executeTool(call.name, call.input, ctx);
        ok = result.ok;
        summary = result.summary;
        if (result.chips && result.chips.length > 0) {
          chips.push(...result.chips);
        }
      } catch (err) {
        ok = false;
        if (err instanceof UnknownToolError) {
          summary =
            input.locale === "ru"
              ? `Инструмент «${call.name}» не зарегистрирован.`
              : `«${call.name}» tool ro'yxatda yo'q.`;
        } else {
          summary =
            input.locale === "ru"
              ? `Ошибка при выполнении инструмента ${call.name}.`
              : `${call.name} tool'i bajarilishda xato.`;
        }
      }
      toolTrace.push({ name: call.name, input: call.input, ok });
      stepResults.push({ name: call.name, ok, summary });
    }

    // Feed the assistant's last "I want to call tools" turn back, then
    // the rendered tool results as a user message. This is a simplified
    // tool-loop wire format — the proxy doesn't surface tool_use blocks,
    // so we collapse to text. Works for Anthropic's prompt-following.
    if (resp.text) {
      messages.push({ role: "assistant", content: resp.text });
    } else {
      messages.push({
        role: "assistant",
        content:
          input.locale === "ru"
            ? "(использую инструменты)"
            : "(tool'lardan foydalanmoqdaman)",
      });
    }
    messages.push({
      role: "user",
      content: renderToolResults(stepResults),
    });
  }

  // Loop hit MAX_ITERATIONS without a terminal text-only response.
  return {
    answer: lastText || fallbackAnswer(input.locale),
    chips,
    toolTrace,
    inputTokens,
    outputTokens,
    costUzs,
  };
}

function fallbackAnswer(locale: "ru" | "uz"): string {
  return locale === "ru"
    ? "Не удалось сформировать ответ. Попробуйте переформулировать вопрос."
    : "Javob shakllantirib bo'lmadi. Savolni boshqacha bering.";
}
