import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  SwarmBudgetIntegration,
  type ISwarmEventBus,
} from '../../src/budgets/SwarmBudgetIntegration.js';
import {
  type IContextBudgetManager,
  type SwarmTopology,
  type ConsumeResult,
  type ReleaseResult,
  type BudgetCheckResult,
  type BudgetSnapshot,
  ThrottleLevel,
} from '../../src/budgets/ContextBudgetManager.js';

// ─── Mock budget manager ─────────────────────────────────────────────

function createMockBudgetManager(): IContextBudgetManager {
  return {
    initializeSwarmBudgets: vi.fn(),
    allocate: vi.fn(),
    allocateFromBuffer: vi.fn(),
    consume: vi.fn<[string, number], ConsumeResult>().mockReturnValue({
      allowed: true,
      throttleLevel: ThrottleLevel.NORMAL,
      remaining: 1000,
      suggestion: null,
    }),
    release: vi.fn<[string], ReleaseResult>().mockReturnValue({
      releasedTokens: 500,
      redistributedTo: [],
    }),
    getRemaining: vi.fn().mockReturnValue(1000),
    getThrottleLevel: vi.fn().mockReturnValue(ThrottleLevel.NORMAL),
    checkBudget: vi.fn<[string], BudgetCheckResult>().mockReturnValue({
      allowed: true,
      throttleLevel: ThrottleLevel.NORMAL,
      remaining: 1000,
      callCount: 0,
      message: null,
    }),
    getSnapshot: vi.fn<[], BudgetSnapshot>().mockReturnValue({
      totalAvailable: 160_000,
      sharedKnowledge: 20_000,
      buffer: 17_120,
      agents: new Map(),
    }),
    rebalance: vi.fn(),
    resetThrottle: vi.fn(),
  };
}

// ─── Mock event bus ──────────────────────────────────────────────────

function createMockEventBus(): ISwarmEventBus & EventEmitter {
  return new EventEmitter() as ISwarmEventBus & EventEmitter;
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('SwarmBudgetIntegration', () => {
  let budgetManager: IContextBudgetManager;
  let eventBus: ISwarmEventBus & EventEmitter;
  let integration: SwarmBudgetIntegration;

  beforeEach(() => {
    budgetManager = createMockBudgetManager();
    eventBus = createMockEventBus();
    integration = new SwarmBudgetIntegration(budgetManager, eventBus);
  });

  describe('event handlers registered', () => {
    it('registers handlers for all four swarm events', () => {
      expect(eventBus.listenerCount('swarm:initialized')).toBe(1);
      expect(eventBus.listenerCount('agent:spawned')).toBe(1);
      expect(eventBus.listenerCount('agent:completed')).toBe(1);
      expect(eventBus.listenerCount('agent:shutdown')).toBe(1);
    });
  });

  describe('swarm:initialized', () => {
    it('calls initializeSwarmBudgets with topology and agentCount', () => {
      eventBus.emit('swarm:initialized', {
        topology: 'hierarchical' as SwarmTopology,
        agentCount: 4,
      });

      expect(budgetManager.initializeSwarmBudgets).toHaveBeenCalledWith(
        'hierarchical',
        4,
      );
    });
  });

  describe('agent:spawned', () => {
    it('calls allocateFromBuffer for the spawned agent', () => {
      eventBus.emit('agent:spawned', { agentId: 'new-agent' });

      expect(budgetManager.allocateFromBuffer).toHaveBeenCalledWith(
        'new-agent',
      );
    });
  });

  describe('agent:completed', () => {
    it('calls release for the completed agent', () => {
      eventBus.emit('agent:completed', { agentId: 'done-agent' });

      expect(budgetManager.release).toHaveBeenCalledWith('done-agent');
    });
  });

  describe('agent:shutdown', () => {
    it('calls release for the shutdown agent', () => {
      eventBus.emit('agent:shutdown', { agentId: 'dead-agent' });

      expect(budgetManager.release).toHaveBeenCalledWith('dead-agent');
    });
  });

  describe('dispose', () => {
    it('unsubscribes from all events', () => {
      integration.dispose();

      expect(eventBus.listenerCount('swarm:initialized')).toBe(0);
      expect(eventBus.listenerCount('agent:spawned')).toBe(0);
      expect(eventBus.listenerCount('agent:completed')).toBe(0);
      expect(eventBus.listenerCount('agent:shutdown')).toBe(0);
    });

    it('stops responding to events after dispose', () => {
      integration.dispose();

      eventBus.emit('swarm:initialized', {
        topology: 'mesh',
        agentCount: 2,
      });

      expect(budgetManager.initializeSwarmBudgets).not.toHaveBeenCalled();
    });
  });
});
