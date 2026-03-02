import { describe, it, expect, beforeEach } from 'vitest';
import { SharedKnowledgeTracker } from '../../src/budgets/SharedKnowledgeTracker.js';

describe('SharedKnowledgeTracker', () => {
  let tracker: SharedKnowledgeTracker;

  beforeEach(() => {
    tracker = new SharedKnowledgeTracker();
  });

  describe('hasContent', () => {
    it('returns false for unknown hash', () => {
      expect(tracker.hasContent('abc123')).toBe(false);
    });

    it('returns true after content is recorded', () => {
      tracker.recordIndex('agent-1', 'abc123');
      expect(tracker.hasContent('abc123')).toBe(true);
    });
  });

  describe('recordIndex', () => {
    it('returns true for new content', () => {
      const isNew = tracker.recordIndex('agent-1', 'hash-a');
      expect(isNew).toBe(true);
    });

    it('returns false when another agent already indexed same hash', () => {
      tracker.recordIndex('agent-1', 'hash-a');
      const isNew = tracker.recordIndex('agent-2', 'hash-a');
      expect(isNew).toBe(false);
    });

    it('returns false when same agent re-indexes same hash', () => {
      tracker.recordIndex('agent-1', 'hash-a');
      const isNew = tracker.recordIndex('agent-1', 'hash-a');
      expect(isNew).toBe(false);
    });

    it('tracks different hashes independently', () => {
      expect(tracker.recordIndex('agent-1', 'hash-a')).toBe(true);
      expect(tracker.recordIndex('agent-1', 'hash-b')).toBe(true);
      expect(tracker.recordIndex('agent-2', 'hash-c')).toBe(true);
    });
  });

  describe('getStats', () => {
    it('starts with zero totals', () => {
      const stats = tracker.getStats();
      expect(stats.totalIndexed).toBe(0);
      expect(stats.deduplicatedCount).toBe(0);
    });

    it('reflects indexed and deduped counts', () => {
      tracker.recordIndex('agent-1', 'hash-a');
      tracker.recordIndex('agent-1', 'hash-b');
      tracker.recordIndex('agent-2', 'hash-a'); // dedup
      tracker.recordIndex('agent-2', 'hash-c');
      tracker.recordIndex('agent-3', 'hash-a'); // dedup
      tracker.recordIndex('agent-3', 'hash-b'); // dedup

      const stats = tracker.getStats();
      expect(stats.totalIndexed).toBe(3); // hash-a, hash-b, hash-c
      expect(stats.deduplicatedCount).toBe(3); // agent-2:hash-a, agent-3:hash-a, agent-3:hash-b
    });
  });

  describe('getAgentHashes', () => {
    it('returns empty set for unknown agent', () => {
      const hashes = tracker.getAgentHashes('ghost');
      expect(hashes.size).toBe(0);
    });

    it('returns hashes indexed by a specific agent', () => {
      tracker.recordIndex('agent-1', 'hash-a');
      tracker.recordIndex('agent-1', 'hash-b');
      tracker.recordIndex('agent-2', 'hash-c');

      const hashes1 = tracker.getAgentHashes('agent-1');
      expect(hashes1.size).toBe(2);
      expect(hashes1.has('hash-a')).toBe(true);
      expect(hashes1.has('hash-b')).toBe(true);

      const hashes2 = tracker.getAgentHashes('agent-2');
      expect(hashes2.size).toBe(1);
      expect(hashes2.has('hash-c')).toBe(true);
    });
  });

  describe('clear', () => {
    it('resets all tracked state', () => {
      tracker.recordIndex('agent-1', 'hash-a');
      tracker.recordIndex('agent-2', 'hash-a');

      tracker.clear();

      expect(tracker.hasContent('hash-a')).toBe(false);
      expect(tracker.getAgentHashes('agent-1').size).toBe(0);

      const stats = tracker.getStats();
      expect(stats.totalIndexed).toBe(0);
      expect(stats.deduplicatedCount).toBe(0);
    });
  });
});
