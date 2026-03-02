import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextBudgetManager,
  ThrottleLevel,
  getThrottleForCallCount,
  AVAILABLE_TOKENS,
  SHARED_KNOWLEDGE_RATIO,
  BUFFER_RATIO,
} from '../../src/budgets/ContextBudgetManager.js';

describe('ContextBudgetManager', () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager();
  });

  // ─── getThrottleForCallCount ─────────────────────────────────────

  describe('getThrottleForCallCount', () => {
    it('returns NORMAL for calls 1-3', () => {
      expect(getThrottleForCallCount(1)).toBe(ThrottleLevel.NORMAL);
      expect(getThrottleForCallCount(2)).toBe(ThrottleLevel.NORMAL);
      expect(getThrottleForCallCount(3)).toBe(ThrottleLevel.NORMAL);
    });

    it('returns REDUCED for calls 4-8', () => {
      expect(getThrottleForCallCount(4)).toBe(ThrottleLevel.REDUCED);
      expect(getThrottleForCallCount(8)).toBe(ThrottleLevel.REDUCED);
    });

    it('returns MINIMAL for calls 9-12', () => {
      expect(getThrottleForCallCount(9)).toBe(ThrottleLevel.MINIMAL);
      expect(getThrottleForCallCount(12)).toBe(ThrottleLevel.MINIMAL);
    });

    it('returns BLOCKED for calls 13+', () => {
      expect(getThrottleForCallCount(13)).toBe(ThrottleLevel.BLOCKED);
      expect(getThrottleForCallCount(100)).toBe(ThrottleLevel.BLOCKED);
    });
  });

  // ─── initializeSwarmBudgets ──────────────────────────────────────

  describe('initializeSwarmBudgets', () => {
    it('rejects agentCount < 1', () => {
      expect(() => manager.initializeSwarmBudgets('mesh', 0)).toThrow(
        'agentCount must be at least 1',
      );
    });

    it('initializes hierarchical: coordinator gets 1.5x base share', () => {
      manager.initializeSwarmBudgets('hierarchical', 4);
      const snap = manager.getSnapshot();

      const coordInfo = snap.agents.get('coordinator')!;
      const workerInfo = snap.agents.get('agent-1')!;

      // coordinator should get ~1.5x what each worker gets
      const ratio = coordInfo.totalAllocated / workerInfo.totalAllocated;
      expect(ratio).toBeGreaterThan(1.4);
      expect(ratio).toBeLessThan(1.6);
    });

    it('initializes mesh: all agents get equal share', () => {
      manager.initializeSwarmBudgets('mesh', 4);
      const snap = manager.getSnapshot();

      const allocations = [...snap.agents.values()].map(
        (a) => a.totalAllocated,
      );
      // All agents should have the same allocation
      expect(new Set(allocations).size).toBe(1);
    });

    it('initializes adaptive: starts with equal allocation', () => {
      manager.initializeSwarmBudgets('adaptive', 3);
      const snap = manager.getSnapshot();

      const allocations = [...snap.agents.values()].map(
        (a) => a.totalAllocated,
      );
      expect(new Set(allocations).size).toBe(1);
    });

    it('reserves shared knowledge and buffer tokens', () => {
      manager.initializeSwarmBudgets('mesh', 4);
      const snap = manager.getSnapshot();

      const expectedShared = Math.floor(
        AVAILABLE_TOKENS * SHARED_KNOWLEDGE_RATIO,
      );
      const expectedBuffer = Math.floor(AVAILABLE_TOKENS * BUFFER_RATIO);

      expect(snap.sharedKnowledge).toBe(expectedShared);
      expect(snap.buffer).toBe(expectedBuffer);
    });

    it('clears previous state when re-initialized', () => {
      manager.initializeSwarmBudgets('mesh', 2);
      manager.initializeSwarmBudgets('hierarchical', 3);
      const snap = manager.getSnapshot();

      expect(snap.agents.size).toBe(3);
      expect(snap.agents.has('coordinator')).toBe(true);
    });
  });

  // ─── consume ─────────────────────────────────────────────────────

  describe('consume', () => {
    beforeEach(() => {
      manager.initializeSwarmBudgets('mesh', 2);
    });

    it('updates remaining correctly after consumption', () => {
      const agentId = 'agent-0';
      const before = manager.getRemaining(agentId);
      const result = manager.consume(agentId, 1000);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(before - 1000);
      expect(manager.getRemaining(agentId)).toBe(before - 1000);
    });

    it('returns allowed: false when tokens exceed budget', () => {
      const agentId = 'agent-0';
      const remaining = manager.getRemaining(agentId);
      const result = manager.consume(agentId, remaining + 1);

      expect(result.allowed).toBe(false);
    });

    it('throws for unknown agent', () => {
      expect(() => manager.consume('unknown', 100)).toThrow(
        'No budget allocated',
      );
    });

    it('increments call count on each consume', () => {
      const agentId = 'agent-0';

      manager.consume(agentId, 10);
      manager.consume(agentId, 10);
      manager.consume(agentId, 10);

      const check = manager.checkBudget(agentId);
      expect(check.callCount).toBe(3);
    });
  });

  // ─── progressive throttling ──────────────────────────────────────

  describe('progressive throttling', () => {
    beforeEach(() => {
      manager.initializeSwarmBudgets('mesh', 1);
    });

    it('calls 1-3 are NORMAL', () => {
      const id = 'agent-0';
      for (let i = 0; i < 3; i++) {
        const r = manager.consume(id, 1);
        expect(r.throttleLevel).toBe(ThrottleLevel.NORMAL);
        expect(r.suggestion).toBeNull();
      }
    });

    it('calls 4-8 are REDUCED with warning', () => {
      const id = 'agent-0';
      // burn through 3 NORMAL calls
      for (let i = 0; i < 3; i++) manager.consume(id, 1);

      for (let i = 0; i < 5; i++) {
        const r = manager.consume(id, 1);
        expect(r.throttleLevel).toBe(ThrottleLevel.REDUCED);
        expect(r.suggestion).toContain('batch');
      }
    });

    it('calls 9-12 are MINIMAL with strong warning', () => {
      const id = 'agent-0';
      for (let i = 0; i < 8; i++) manager.consume(id, 1);

      for (let i = 0; i < 4; i++) {
        const r = manager.consume(id, 1);
        expect(r.throttleLevel).toBe(ThrottleLevel.MINIMAL);
        expect(r.suggestion).toContain('batch_execute');
      }
    });

    it('calls 13+ are BLOCKED', () => {
      const id = 'agent-0';
      for (let i = 0; i < 12; i++) manager.consume(id, 1);

      const r = manager.consume(id, 1);
      expect(r.allowed).toBe(false);
      expect(r.throttleLevel).toBe(ThrottleLevel.BLOCKED);
      expect(r.suggestion).toContain('batch_execute');
    });
  });

  // ─── resetThrottle ───────────────────────────────────────────────

  describe('resetThrottle', () => {
    it('resets call count so throttle returns to NORMAL', () => {
      manager.initializeSwarmBudgets('mesh', 1);
      const id = 'agent-0';

      // Go to BLOCKED
      for (let i = 0; i < 13; i++) manager.consume(id, 1);
      expect(manager.getThrottleLevel(id)).toBe(ThrottleLevel.BLOCKED);

      manager.resetThrottle(id);
      expect(manager.getThrottleLevel(id)).toBe(ThrottleLevel.NORMAL);

      // Can consume again
      const r = manager.consume(id, 1);
      expect(r.allowed).toBe(true);
      expect(r.throttleLevel).toBe(ThrottleLevel.NORMAL);
    });
  });

  // ─── release ─────────────────────────────────────────────────────

  describe('release', () => {
    it('returns released tokens to buffer', () => {
      manager.initializeSwarmBudgets('mesh', 3);
      const beforeSnap = manager.getSnapshot();
      const agentRemaining = manager.getRemaining('agent-0');

      manager.consume('agent-0', 500);
      const result = manager.release('agent-0');

      expect(result.releasedTokens).toBe(agentRemaining - 500);
      expect(manager.getSnapshot().agents.has('agent-0')).toBe(false);
    });

    it('redistributes buffer to remaining agents', () => {
      manager.initializeSwarmBudgets('mesh', 3);
      const agent1Before = manager.getRemaining('agent-1');

      manager.release('agent-0');

      // agent-1 should have more tokens now
      expect(manager.getRemaining('agent-1')).toBeGreaterThan(agent1Before);
    });

    it('returns empty result for unknown agent', () => {
      const result = manager.release('nonexistent');
      expect(result.releasedTokens).toBe(0);
      expect(result.redistributedTo).toEqual([]);
    });
  });

  // ─── rebalance ───────────────────────────────────────────────────

  describe('rebalance', () => {
    it('distributes buffer to remaining agents', () => {
      manager.initializeSwarmBudgets('mesh', 3);

      // Release one agent to fill buffer
      manager.release('agent-0');
      const snap1 = manager.getSnapshot();
      const agent1After = snap1.agents.get('agent-1')!.totalAllocated;

      // Agent-1 should have received some of the released tokens
      expect(agent1After).toBeGreaterThan(0);
    });
  });

  // ─── allocateFromBuffer ──────────────────────────────────────────

  describe('allocateFromBuffer', () => {
    it('allocates tokens from buffer for dynamically spawned agents', () => {
      manager.initializeSwarmBudgets('mesh', 2);
      const snapBefore = manager.getSnapshot();
      const bufferBefore = snapBefore.buffer;

      manager.allocateFromBuffer('dynamic-agent');

      const snapAfter = manager.getSnapshot();
      expect(snapAfter.agents.has('dynamic-agent')).toBe(true);
      expect(snapAfter.buffer).toBeLessThan(bufferBefore);
      expect(snapAfter.agents.get('dynamic-agent')!.totalAllocated).toBeGreaterThan(0);
    });

    it('registers agent even when buffer is empty', () => {
      manager.initializeSwarmBudgets('mesh', 1);
      // Drain buffer via release + rebalance cycle
      manager.rebalance();
      const snap1 = manager.getSnapshot();

      // Even if buffer is tiny/zero, agent should be registered
      manager.allocateFromBuffer('late-agent');
      expect(manager.getSnapshot().agents.has('late-agent')).toBe(true);
    });
  });

  // ─── getSnapshot ─────────────────────────────────────────────────

  describe('getSnapshot', () => {
    it('returns complete state with all agent info', () => {
      manager.initializeSwarmBudgets('hierarchical', 3);
      manager.consume('coordinator', 500);

      const snap = manager.getSnapshot();

      expect(snap.totalAvailable).toBe(AVAILABLE_TOKENS);
      expect(snap.agents.size).toBe(3);

      const coord = snap.agents.get('coordinator')!;
      expect(coord.consumed).toBe(500);
      expect(coord.remaining).toBe(coord.totalAllocated - 500);
      expect(coord.callCount).toBe(1);
      expect(coord.throttleLevel).toBe(ThrottleLevel.NORMAL);
    });
  });

  // ─── checkBudget ─────────────────────────────────────────────────

  describe('checkBudget', () => {
    it('returns allowed: false for unknown agent', () => {
      const check = manager.checkBudget('ghost');
      expect(check.allowed).toBe(false);
      expect(check.message).toContain('ghost');
    });

    it('returns appropriate suggestions at each throttle level', () => {
      manager.initializeSwarmBudgets('mesh', 1);
      const id = 'agent-0';

      // NORMAL
      let check = manager.checkBudget(id);
      expect(check.allowed).toBe(true);
      expect(check.throttleLevel).toBe(ThrottleLevel.NORMAL);
      expect(check.message).toBeNull();

      // Advance to REDUCED
      for (let i = 0; i < 4; i++) manager.consume(id, 1);
      check = manager.checkBudget(id);
      expect(check.throttleLevel).toBe(ThrottleLevel.REDUCED);
      expect(check.message).not.toBeNull();

      // Advance to MINIMAL
      for (let i = 0; i < 5; i++) manager.consume(id, 1);
      check = manager.checkBudget(id);
      expect(check.throttleLevel).toBe(ThrottleLevel.MINIMAL);

      // Advance to BLOCKED
      for (let i = 0; i < 4; i++) manager.consume(id, 1);
      check = manager.checkBudget(id);
      expect(check.throttleLevel).toBe(ThrottleLevel.BLOCKED);
      expect(check.allowed).toBe(false);
    });
  });

  // ─── allocate ────────────────────────────────────────────────────

  describe('allocate', () => {
    it('creates new agent with specified tokens', () => {
      manager.allocate('custom-agent', 5000);
      expect(manager.getRemaining('custom-agent')).toBe(5000);
    });

    it('adds tokens to existing agent', () => {
      manager.allocate('custom-agent', 5000);
      manager.allocate('custom-agent', 3000);
      expect(manager.getRemaining('custom-agent')).toBe(8000);
    });

    it('rejects negative tokens', () => {
      expect(() => manager.allocate('a', -100)).toThrow('non-negative');
    });
  });
});
