/**
 * BudgetExceededEvent — emitted when a context budget is exceeded.
 */
import { type DomainEvent } from './DomainEvent.js';
import { type ThrottleLevel } from '../value-objects/ContextBudget.js';

export interface BudgetExceededEvent extends DomainEvent {
  readonly type: 'context.budget_exceeded';
  readonly sessionId: string;
  readonly agentId: string;
  readonly budgetTotal: number;
  readonly attempted: number;
  readonly throttleLevel: ThrottleLevel;
}

export function createBudgetExceededEvent(params: {
  sessionId: string;
  agentId: string;
  budgetTotal: number;
  attempted: number;
  throttleLevel: ThrottleLevel;
}): BudgetExceededEvent {
  return {
    type: 'context.budget_exceeded',
    occurredAt: new Date(),
    ...params,
  };
}
