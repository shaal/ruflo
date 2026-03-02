/**
 * ContextBudgetManager — Per-agent context budget allocation, tracking,
 * progressive throttling, and swarm-aware rebalancing.
 *
 * Constants (200K model context):
 *   - 20% system reserve (40K)
 *   - 12.5% shared knowledge
 *   - 10.7% reallocation buffer
 *   - Remainder distributed to agents based on topology
 *
 * @see ADR-059c
 */

import { SharedKnowledgeTracker } from './SharedKnowledgeTracker.js';

// ─── Constants ───────────────────────────────────────────────────────

export const TOTAL_CONTEXT_TOKENS = 200_000;
export const SYSTEM_RESERVE_RATIO = 0.20;
export const SHARED_KNOWLEDGE_RATIO = 0.125;
export const BUFFER_RATIO = 0.107;

export const AVAILABLE_TOKENS = Math.floor(
  TOTAL_CONTEXT_TOKENS * (1 - SYSTEM_RESERVE_RATIO),
); // 160K

// ─── Throttle enum (call-count-based) ────────────────────────────────

export enum ThrottleLevel {
  NORMAL = 'normal',
  REDUCED = 'reduced',
  MINIMAL = 'minimal',
  BLOCKED = 'blocked',
}

export function getThrottleForCallCount(callCount: number): ThrottleLevel {
  if (callCount <= 3) return ThrottleLevel.NORMAL;
  if (callCount <= 8) return ThrottleLevel.REDUCED;
  if (callCount <= 12) return ThrottleLevel.MINIMAL;
  return ThrottleLevel.BLOCKED;
}

// ─── Types ───────────────────────────────────────────────────────────

export type SwarmTopology = 'hierarchical' | 'mesh' | 'adaptive';

export interface ConsumeResult {
  allowed: boolean;
  throttleLevel: ThrottleLevel;
  remaining: number;
  suggestion: string | null;
}

export interface ReleaseResult {
  releasedTokens: number;
  redistributedTo: string[];
}

export interface BudgetCheckResult {
  allowed: boolean;
  throttleLevel: ThrottleLevel;
  remaining: number;
  callCount: number;
  message: string | null;
}

export interface BudgetSnapshot {
  totalAvailable: number;
  sharedKnowledge: number;
  buffer: number;
  agents: Map<string, AgentBudgetInfo>;
}

export interface AgentBudgetInfo {
  agentId: string;
  totalAllocated: number;
  consumed: number;
  remaining: number;
  callCount: number;
  throttleLevel: ThrottleLevel;
}

// ─── Interface ───────────────────────────────────────────────────────

export interface IContextBudgetManager {
  initializeSwarmBudgets(topology: SwarmTopology, agentCount: number): void;
  allocate(agentId: string, tokens: number): void;
  allocateFromBuffer(agentId: string): void;
  consume(agentId: string, tokens: number): ConsumeResult;
  release(agentId: string): ReleaseResult;
  getRemaining(agentId: string): number;
  getThrottleLevel(agentId: string): ThrottleLevel;
  checkBudget(agentId: string): BudgetCheckResult;
  getSnapshot(): BudgetSnapshot;
  rebalance(): void;
  resetThrottle(agentId: string): void;
}

// ─── Internal state per agent ────────────────────────────────────────

interface AgentState {
  totalAllocated: number;
  consumed: number;
  callCount: number;
}

// ─── Throttle messages ───────────────────────────────────────────────

const THROTTLE_SUGGESTIONS: Record<ThrottleLevel, string | null> = {
  [ThrottleLevel.NORMAL]: null,
  [ThrottleLevel.REDUCED]:
    'Consider batching queries to reduce context usage.',
  [ThrottleLevel.MINIMAL]:
    'Context budget nearly exhausted. Use batch_execute to reset throttle.',
  [ThrottleLevel.BLOCKED]:
    'Budget blocked after 13+ sequential calls. Must use batch_execute to continue.',
};

// ─── Implementation ──────────────────────────────────────────────────

export class ContextBudgetManager implements IContextBudgetManager {
  private agents = new Map<string, AgentState>();
  private bufferTokens: number = 0;
  private sharedKnowledgeTokens: number = 0;
  private topology: SwarmTopology = 'mesh';
  private readonly sharedKnowledge = new SharedKnowledgeTracker();

  /**
   * Initialize budget allocations for all agents in a swarm.
   * Distributes AVAILABLE_TOKENS minus shared-knowledge and buffer
   * reserves across agents based on the chosen topology.
   */
  initializeSwarmBudgets(
    topology: SwarmTopology,
    agentCount: number,
  ): void {
    if (agentCount < 1) {
      throw new RangeError('agentCount must be at least 1');
    }

    this.topology = topology;
    this.agents.clear();

    this.sharedKnowledgeTokens = Math.floor(
      AVAILABLE_TOKENS * SHARED_KNOWLEDGE_RATIO,
    );
    this.bufferTokens = Math.floor(AVAILABLE_TOKENS * BUFFER_RATIO);

    const distributable =
      AVAILABLE_TOKENS - this.sharedKnowledgeTokens - this.bufferTokens;

    const allocations = this.computeAllocations(
      topology,
      agentCount,
      distributable,
    );

    let idx = 0;
    for (const [role, tokens] of allocations) {
      const agentId = idx === 0 && topology === 'hierarchical'
        ? 'coordinator'
        : `agent-${idx}`;
      this.agents.set(role !== '' ? role : agentId, {
        totalAllocated: tokens,
        consumed: 0,
        callCount: 0,
      });
      idx++;
    }
  }

  /**
   * Allocate a specific number of tokens to an agent.
   */
  allocate(agentId: string, tokens: number): void {
    if (tokens < 0) {
      throw new RangeError('tokens must be non-negative');
    }
    const existing = this.agents.get(agentId);
    if (existing) {
      existing.totalAllocated += tokens;
    } else {
      this.agents.set(agentId, {
        totalAllocated: tokens,
        consumed: 0,
        callCount: 0,
      });
    }
  }

  /**
   * Allocate tokens from the buffer for a dynamically spawned agent.
   * Gives the agent an equal share of the current buffer.
   */
  allocateFromBuffer(agentId: string): void {
    const activeCount = this.agents.size + 1; // including the new agent
    const share = Math.floor(this.bufferTokens / activeCount);

    if (share <= 0) {
      // Even with 0 tokens, register the agent so it can be tracked
      this.agents.set(agentId, {
        totalAllocated: 0,
        consumed: 0,
        callCount: 0,
      });
      return;
    }

    this.bufferTokens -= share;
    this.agents.set(agentId, {
      totalAllocated: share,
      consumed: 0,
      callCount: 0,
    });
  }

  /**
   * Consume tokens for an agent. Increments call count and applies
   * progressive throttling.
   */
  consume(agentId: string, tokens: number): ConsumeResult {
    const state = this.getAgentState(agentId);
    state.callCount++;

    const throttle = getThrottleForCallCount(state.callCount);
    const remaining = state.totalAllocated - state.consumed;

    if (throttle === ThrottleLevel.BLOCKED) {
      return {
        allowed: false,
        throttleLevel: ThrottleLevel.BLOCKED,
        remaining,
        suggestion: THROTTLE_SUGGESTIONS[ThrottleLevel.BLOCKED],
      };
    }

    if (tokens > remaining) {
      return {
        allowed: false,
        throttleLevel: throttle,
        remaining,
        suggestion: `Requested ${tokens} tokens but only ${remaining} remain.`,
      };
    }

    state.consumed += tokens;
    const newRemaining = state.totalAllocated - state.consumed;

    return {
      allowed: true,
      throttleLevel: throttle,
      remaining: newRemaining,
      suggestion: THROTTLE_SUGGESTIONS[throttle],
    };
  }

  /**
   * Release an agent's remaining budget back to the buffer and
   * redistribute via rebalance.
   */
  release(agentId: string): ReleaseResult {
    const state = this.agents.get(agentId);
    if (!state) {
      return { releasedTokens: 0, redistributedTo: [] };
    }

    const releasedTokens = state.totalAllocated - state.consumed;
    this.bufferTokens += releasedTokens;
    this.agents.delete(agentId);

    const redistributedTo = this.rebalanceInternal();

    return { releasedTokens, redistributedTo };
  }

  /**
   * Get remaining token budget for an agent.
   */
  getRemaining(agentId: string): number {
    const state = this.agents.get(agentId);
    if (!state) return 0;
    return state.totalAllocated - state.consumed;
  }

  /**
   * Get the current throttle level for an agent based on call count.
   */
  getThrottleLevel(agentId: string): ThrottleLevel {
    const state = this.agents.get(agentId);
    if (!state) return ThrottleLevel.NORMAL;
    return getThrottleForCallCount(state.callCount);
  }

  /**
   * Check an agent's budget status without consuming tokens.
   */
  checkBudget(agentId: string): BudgetCheckResult {
    const state = this.agents.get(agentId);
    if (!state) {
      return {
        allowed: false,
        throttleLevel: ThrottleLevel.BLOCKED,
        remaining: 0,
        callCount: 0,
        message: `Agent "${agentId}" has no budget allocation.`,
      };
    }

    const remaining = state.totalAllocated - state.consumed;
    const throttle = getThrottleForCallCount(state.callCount);
    const allowed = throttle !== ThrottleLevel.BLOCKED && remaining > 0;

    return {
      allowed,
      throttleLevel: throttle,
      remaining,
      callCount: state.callCount,
      message: THROTTLE_SUGGESTIONS[throttle],
    };
  }

  /**
   * Get a snapshot of the entire budget state.
   */
  getSnapshot(): BudgetSnapshot {
    const agentMap = new Map<string, AgentBudgetInfo>();

    for (const [agentId, state] of this.agents) {
      agentMap.set(agentId, {
        agentId,
        totalAllocated: state.totalAllocated,
        consumed: state.consumed,
        remaining: state.totalAllocated - state.consumed,
        callCount: state.callCount,
        throttleLevel: getThrottleForCallCount(state.callCount),
      });
    }

    return {
      totalAvailable: AVAILABLE_TOKENS,
      sharedKnowledge: this.sharedKnowledgeTokens,
      buffer: this.bufferTokens,
      agents: agentMap,
    };
  }

  /**
   * Rebalance buffer tokens evenly across all active agents.
   */
  rebalance(): void {
    this.rebalanceInternal();
  }

  /**
   * Reset an agent's call count (e.g., after batch_execute).
   */
  resetThrottle(agentId: string): void {
    const state = this.agents.get(agentId);
    if (state) {
      state.callCount = 0;
    }
  }

  /**
   * Access the shared knowledge tracker for cross-agent dedup.
   */
  getSharedKnowledgeTracker(): SharedKnowledgeTracker {
    return this.sharedKnowledge;
  }

  // ─── Private helpers ─────────────────────────────────────────────

  private getAgentState(agentId: string): AgentState {
    const state = this.agents.get(agentId);
    if (!state) {
      throw new Error(`No budget allocated for agent "${agentId}"`);
    }
    return state;
  }

  private rebalanceInternal(): string[] {
    if (this.bufferTokens <= 0 || this.agents.size === 0) {
      return [];
    }

    const perAgent = Math.floor(this.bufferTokens / this.agents.size);
    if (perAgent <= 0) return [];

    const redistributedTo: string[] = [];
    for (const [agentId, state] of this.agents) {
      state.totalAllocated += perAgent;
      redistributedTo.push(agentId);
    }

    // Leftover from rounding stays in buffer
    this.bufferTokens -= perAgent * this.agents.size;

    return redistributedTo;
  }

  private computeAllocations(
    topology: SwarmTopology,
    agentCount: number,
    distributable: number,
  ): Map<string, number> {
    switch (topology) {
      case 'hierarchical':
        return this.hierarchicalAllocation(agentCount, distributable);
      case 'mesh':
        return this.meshAllocation(agentCount, distributable);
      case 'adaptive':
        return this.meshAllocation(agentCount, distributable);
    }
  }

  private hierarchicalAllocation(
    agentCount: number,
    distributable: number,
  ): Map<string, number> {
    const result = new Map<string, number>();

    if (agentCount === 1) {
      result.set('coordinator', distributable);
      return result;
    }

    // coordinator gets 1.5x a base share
    // baseShare * (agentCount - 1) + 1.5 * baseShare = distributable
    // baseShare * (agentCount + 0.5) = distributable
    const baseShare = Math.floor(distributable / (agentCount + 0.5));
    const coordinatorShare = Math.floor(baseShare * 1.5);
    const workerTotal = distributable - coordinatorShare;
    const workerShare = Math.floor(workerTotal / (agentCount - 1));

    result.set('coordinator', coordinatorShare);
    for (let i = 1; i < agentCount; i++) {
      result.set(`agent-${i}`, workerShare);
    }

    return result;
  }

  private meshAllocation(
    agentCount: number,
    distributable: number,
  ): Map<string, number> {
    const result = new Map<string, number>();
    const perAgent = Math.floor(distributable / agentCount);

    for (let i = 0; i < agentCount; i++) {
      result.set(`agent-${i}`, perAgent);
    }

    return result;
  }
}
