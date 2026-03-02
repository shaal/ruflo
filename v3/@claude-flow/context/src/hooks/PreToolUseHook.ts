/**
 * PreToolUseHook — Intercepts tool calls before execution for
 * budget enforcement and batching suggestions.
 *
 * Checks the agent's context budget throttle level and either
 * proceeds, warns, or blocks with an alternative suggestion.
 *
 * @see ADR-059c
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface PreToolUseEvent {
  toolName: string;
  toolArgs: Record<string, unknown>;
  agentId?: string;
}

export interface HookResult {
  action: 'proceed' | 'suggest_alternative' | 'modify_args';
  message?: string;
  suggestedTool?: string;
  modifiedArgs?: Record<string, unknown>;
}

export interface IBudgetChecker {
  checkBudget(agentId: string): BudgetCheckInfo;
}

export interface BudgetCheckInfo {
  allowed: boolean;
  throttleLevel: string;
  remaining: number;
  callCount: number;
  message: string | null;
}

// ─── Implementation ─────────────────────────────────────────────────

export class PreToolUseHook {
  constructor(private readonly budgetChecker: IBudgetChecker) {}

  async handle(event: PreToolUseEvent): Promise<HookResult> {
    const agentId = event.agentId;

    // No agent context — proceed without budget check
    if (!agentId) {
      return { action: 'proceed' };
    }

    const check = this.budgetChecker.checkBudget(agentId);

    switch (check.throttleLevel) {
      case 'blocked':
        return {
          action: 'suggest_alternative',
          message:
            'Budget blocked. Use batch_execute to reset throttle and continue.',
          suggestedTool: 'batch_execute',
        };

      case 'minimal':
        return {
          action: 'proceed',
          message: `Warning: Context budget nearly exhausted (${check.remaining} tokens remaining). Consider using batch_execute.`,
        };

      case 'reduced':
        return {
          action: 'proceed',
          message: `Context budget reduced (${check.remaining} tokens remaining). Consider batching queries.`,
        };

      default:
        return { action: 'proceed' };
    }
  }
}
