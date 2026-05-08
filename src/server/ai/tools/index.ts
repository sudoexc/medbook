/**
 * Phase 15 Wave 3 — typed registry of read-only tools available to the
 * NL Command Bar's tool-calling loop.
 *
 * EVERY tool here is read-only by design — see the file header in
 * `src/server/ai/tool-loop.ts` for the rationale. If a future tool needs
 * to mutate state, it does NOT belong in this registry.
 *
 * The registry exposes:
 *   - `TOOL_REGISTRY`: name → Tool, used to look up a tool by name when the
 *     LLM emits a tool_use block.
 *   - `getToolDescriptors()`: returns the list of {name, description,
 *     input_schema} the LLM proxy passes to Anthropic.
 *   - `executeTool(name, input, context)`: dispatch helper for the loop.
 */

import { findFreeSlotsTool } from "./find-free-slots";
import { findPatientTool } from "./find-patient";
import { getAppointmentsTodayTool } from "./get-appointments-today";
import { searchActionsTool } from "./search-actions";
import type { Tool, ToolContext, ToolResult } from "./types";

export type { Tool, ToolContext, ToolResult, Chip, ChipKind } from "./types";

const TOOLS: Tool<unknown>[] = [
  findFreeSlotsTool as unknown as Tool<unknown>,
  findPatientTool as unknown as Tool<unknown>,
  getAppointmentsTodayTool as unknown as Tool<unknown>,
  searchActionsTool as unknown as Tool<unknown>,
];

export const TOOL_REGISTRY: Record<string, Tool<unknown>> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t]),
);

/**
 * Tool descriptor list in the shape `callLLM({ tools })` expects (no
 * `execute` callback, just name + description + JSON schema).
 */
export function getToolDescriptors(): Array<{
  name: string;
  description: string;
  input_schema: object;
}> {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/**
 * Execute a tool by name. Throws `UnknownToolError` for unregistered names —
 * the loop catches this and surfaces it as a tool-result error.
 */
export class UnknownToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
    this.name = "UnknownToolError";
  }
}

export async function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_REGISTRY[name];
  if (!tool) throw new UnknownToolError(name);
  return tool.execute(input, context);
}
