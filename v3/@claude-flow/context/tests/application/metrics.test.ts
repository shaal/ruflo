/**
 * MetricsCollector tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector } from '../../src/application/MetricsCollector.js';

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('recordCompression', () => {
    it('should track per-tool stats', () => {
      collector.recordCompression('Read', 1000, 200);
      collector.recordCompression('Read', 2000, 500);

      const stats = collector.getToolStats('Read');
      expect(stats.invocations).toBe(2);
      expect(stats.totalRawBytes).toBe(3000);
      expect(stats.totalCompressedBytes).toBe(700);
    });

    it('should compute average ratio correctly', () => {
      collector.recordCompression('Bash', 1000, 500);

      const stats = collector.getToolStats('Bash');
      expect(stats.avgRatio).toBeCloseTo(0.5);
    });

    it('should return zeroed stats for unknown tools', () => {
      const stats = collector.getToolStats('Unknown');

      expect(stats.invocations).toBe(0);
      expect(stats.avgRatio).toBe(0);
    });
  });

  describe('recordSearch', () => {
    it('should accumulate search metrics', () => {
      collector.recordSearch(2, 10, 50);
      collector.recordSearch(1, 5, 30);

      const session = collector.getSessionStats();
      expect(session.search.totalQueries).toBe(3);
      expect(session.search.totalResults).toBe(15);
      expect(session.search.avgDurationMs).toBe(27); // (50+30)/3 rounded
    });
  });

  describe('getSessionStats', () => {
    it('should aggregate across all tools', () => {
      collector.recordCompression('Read', 1000, 200);
      collector.recordCompression('Bash', 2000, 800);

      const session = collector.getSessionStats();
      expect(session.totalCompressions).toBe(2);
      expect(session.totalRawBytes).toBe(3000);
      expect(session.totalCompressedBytes).toBe(1000);
      expect(session.overallRatio).toBeCloseTo(2 / 3, 2);
      expect(session.tools).toHaveLength(2);
    });

    it('should handle empty state', () => {
      const session = collector.getSessionStats();

      expect(session.totalCompressions).toBe(0);
      expect(session.overallRatio).toBe(0);
      expect(session.tools).toHaveLength(0);
      expect(session.search.avgDurationMs).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all tracked state', () => {
      collector.recordCompression('Read', 1000, 200);
      collector.recordSearch(1, 5, 10);
      collector.reset();

      const session = collector.getSessionStats();
      expect(session.totalCompressions).toBe(0);
      expect(session.search.totalQueries).toBe(0);
      expect(session.tools).toHaveLength(0);
    });
  });
});
