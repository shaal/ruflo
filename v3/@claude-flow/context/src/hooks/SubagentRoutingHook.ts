/**
 * SubagentRoutingHook — Injects batch operation instructions into
 * subagent prompts to encourage efficient tool usage.
 *
 * Only applies when the tool being invoked is 'Agent' or 'Task',
 * meaning a subagent is being spawned. Appends routing instructions
 * to the subagent's prompt to guide it toward batching.
 *
 * @see ADR-059c
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface SubagentToolEvent {
  toolName: string;
  toolArgs: Record<string, unknown>;
  agentId?: string;
}

export interface SubagentHookResult {
  action: 'proceed' | 'modify_args';
  modifiedArgs?: Record<string, unknown>;
}

// ─── Constants ──────────────────────────────────────────────────────

const SUBAGENT_TOOL_NAMES = new Set(['Agent', 'Task']);

const ROUTING_INSTRUCTIONS = `
IMPORTANT: Use batch_execute for multiple operations.
Use search(queries: [...]) for multi-query knowledge retrieval.
Avoid sequential single-tool calls when batching is possible.
`.trim();

// ─── Implementation ─────────────────────────────────────────────────

export class SubagentRoutingHook {
  static readonly ROUTING_INSTRUCTIONS = ROUTING_INSTRUCTIONS;

  async handle(event: SubagentToolEvent): Promise<SubagentHookResult> {
    if (!SUBAGENT_TOOL_NAMES.has(event.toolName)) {
      return { action: 'proceed' };
    }

    const args = { ...event.toolArgs };

    // Append instructions to the prompt field
    const promptKey = this.findPromptKey(args);
    if (promptKey) {
      const existing = String(args[promptKey] ?? '');
      args[promptKey] = existing + '\n\n' + ROUTING_INSTRUCTIONS;
    }

    return {
      action: 'modify_args',
      modifiedArgs: args,
    };
  }

  private findPromptKey(args: Record<string, unknown>): string | null {
    // Check common prompt field names
    for (const key of ['prompt', 'description', 'instructions', 'message']) {
      if (key in args && typeof args[key] === 'string') {
        return key;
      }
    }
    return null;
  }
}
