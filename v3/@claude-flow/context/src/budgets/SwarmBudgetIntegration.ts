/**
 * SwarmBudgetIntegration — Event-driven bridge between the swarm
 * coordinator lifecycle and the context budget manager.
 *
 * Subscribes to swarm events and translates them into budget
 * operations (allocate, release, rebalance).
 *
 * Uses a minimal ISwarmEventBus interface to stay decoupled from
 * the concrete @claude-flow/swarm package.
 *
 * @see ADR-059c
 */

import {
  type IContextBudgetManager,
  type SwarmTopology,
} from './ContextBudgetManager.js';

// ─── Event bus port ──────────────────────────────────────────────────

export interface ISwarmEventBus {
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
}

// ─── Event payloads ──────────────────────────────────────────────────

export interface SwarmInitializedPayload {
  topology: SwarmTopology;
  agentCount: number;
}

export interface AgentLifecyclePayload {
  agentId: string;
}

// ─── Integration ─────────────────────────────────────────────────────

export class SwarmBudgetIntegration {
  private readonly handlers: Array<{
    event: string;
    handler: (...args: unknown[]) => void;
  }> = [];

  constructor(
    private readonly budgetManager: IContextBudgetManager,
    private readonly eventBus: ISwarmEventBus,
  ) {
    this.bindEvents();
  }

  /**
   * Unsubscribe from all swarm events and clean up.
   */
  dispose(): void {
    for (const { event, handler } of this.handlers) {
      this.eventBus.off(event, handler);
    }
    this.handlers.length = 0;
  }

  // ─── Private ─────────────────────────────────────────────────────

  private bindEvents(): void {
    this.subscribe('swarm:initialized', this.onSwarmInitialized);
    this.subscribe('agent:spawned', this.onAgentSpawned);
    this.subscribe('agent:completed', this.onAgentCompleted);
    this.subscribe('agent:shutdown', this.onAgentShutdown);
  }

  private subscribe(
    event: string,
    handler: (...args: unknown[]) => void,
  ): void {
    const bound = handler.bind(this);
    this.eventBus.on(event, bound);
    this.handlers.push({ event, handler: bound });
  }

  private onSwarmInitialized(payload: unknown): void {
    const p = this.validateSwarmPayload(payload);
    if (p) this.budgetManager.initializeSwarmBudgets(p.topology, p.agentCount);
  }

  private onAgentSpawned(payload: unknown): void {
    const p = this.validateAgentPayload(payload);
    if (p) this.budgetManager.allocateFromBuffer(p.agentId);
  }

  private onAgentCompleted(payload: unknown): void {
    const p = this.validateAgentPayload(payload);
    if (p) this.budgetManager.release(p.agentId);
  }

  private onAgentShutdown(payload: unknown): void {
    const p = this.validateAgentPayload(payload);
    if (p) this.budgetManager.release(p.agentId);
  }

  private validateSwarmPayload(payload: unknown): SwarmInitializedPayload | null {
    if (
      typeof payload === 'object' && payload !== null &&
      'topology' in payload && typeof (payload as any).topology === 'string' &&
      'agentCount' in payload && typeof (payload as any).agentCount === 'number'
    ) {
      return payload as SwarmInitializedPayload;
    }
    return null;
  }

  private validateAgentPayload(payload: unknown): AgentLifecyclePayload | null {
    if (
      typeof payload === 'object' && payload !== null &&
      'agentId' in payload && typeof (payload as any).agentId === 'string'
    ) {
      return payload as AgentLifecyclePayload;
    }
    return null;
  }
}
