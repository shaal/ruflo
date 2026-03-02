/**
 * IContextBudgetRepository — Repository interface for persisting per-agent context budgets.
 */
import { type ContextBudget } from '../value-objects/ContextBudget.js';

export interface IContextBudgetRepository {
  save(agentId: string, budget: ContextBudget): Promise<void>;
  load(agentId: string): Promise<ContextBudget | null>;
  loadAll(): Promise<Map<string, ContextBudget>>;
  delete(agentId: string): Promise<void>;
}
