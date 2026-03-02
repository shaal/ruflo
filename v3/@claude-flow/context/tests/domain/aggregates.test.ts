import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CompressionSession } from '../../src/domain/aggregates/CompressionSession.js';
import { KnowledgeBase } from '../../src/domain/aggregates/KnowledgeBase.js';
import { KnowledgeChunk } from '../../src/domain/entities/KnowledgeChunk.js';
import { CompressionRatio } from '../../src/domain/value-objects/CompressionRatio.js';

describe('CompressionSession', () => {
  it('auto-generates sessionId', () => {
    const session = new CompressionSession();
    expect(session.sessionId).toBeDefined();
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it('accepts custom sessionId', () => {
    const session = new CompressionSession('my-session');
    expect(session.sessionId).toBe('my-session');
  });

  it('starts with zero overall ratio', () => {
    const session = new CompressionSession();
    expect(session.getOverallRatio().equals(CompressionRatio.none())).toBe(true);
  });

  describe('recordCompression', () => {
    it('records a single compression', () => {
      const session = new CompressionSession();
      session.recordCompression('Read', 1000, 300);
      const stats = session.getStats();
      expect(stats.totalRawBytes).toBe(1000);
      expect(stats.totalCompressedBytes).toBe(300);
      expect(stats.overallRatio.getValue()).toBeCloseTo(0.7);
    });

    it('accumulates multiple compressions for same tool', () => {
      const session = new CompressionSession();
      session.recordCompression('Read', 1000, 300);
      session.recordCompression('Read', 500, 100);
      const stats = session.getStats();
      expect(stats.totalRawBytes).toBe(1500);
      expect(stats.totalCompressedBytes).toBe(400);
      const toolStat = stats.toolStats.find((t) => t.toolName === 'Read')!;
      expect(toolStat.invocations).toBe(2);
      expect(toolStat.totalRawBytes).toBe(1500);
    });

    it('tracks multiple tools separately', () => {
      const session = new CompressionSession();
      session.recordCompression('Read', 1000, 300);
      session.recordCompression('Bash', 500, 100);
      const stats = session.getStats();
      expect(stats.toolStats).toHaveLength(2);
      expect(stats.toolStats.map((t) => t.toolName).sort()).toEqual(['Bash', 'Read']);
    });

    it('throws for negative sizes', () => {
      const session = new CompressionSession();
      expect(() => session.recordCompression('Read', -1, 0)).toThrow(RangeError);
      expect(() => session.recordCompression('Read', 100, -1)).toThrow(RangeError);
    });

    it('throws when compressedSize exceeds rawSize', () => {
      const session = new CompressionSession();
      expect(() => session.recordCompression('Read', 100, 200)).toThrow(RangeError);
    });

    it('handles zero rawSize', () => {
      const session = new CompressionSession();
      session.recordCompression('Read', 0, 0);
      expect(session.getOverallRatio().equals(CompressionRatio.none())).toBe(true);
    });
  });

  describe('events', () => {
    it('emits OutputCompressedEvent on record', () => {
      const session = new CompressionSession('s1');
      session.recordCompression('Read', 1000, 300);
      const events = session.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('context.output_compressed');
      const event = events[0] as any;
      expect(event.sessionId).toBe('s1');
      expect(event.toolName).toBe('Read');
      expect(event.rawSize).toBe(1000);
      expect(event.compressedSize).toBe(300);
      expect(event.ratio).toBeCloseTo(0.7);
    });

    it('pullEvents drains the queue', () => {
      const session = new CompressionSession();
      session.recordCompression('Read', 100, 50);
      session.recordCompression('Bash', 200, 100);
      expect(session.pullEvents()).toHaveLength(2);
      expect(session.pullEvents()).toHaveLength(0);
    });
  });
});

describe('KnowledgeBase', () => {
  const source = { toolName: 'Read', filePath: '/test.ts' };

  function makeChunk(content: string, createdAt?: Date): KnowledgeChunk {
    return new KnowledgeChunk({
      content,
      heading: 'Test',
      source,
      sessionId: 'session-1',
      createdAt,
    });
  }

  it('auto-generates sessionId', () => {
    const kb = new KnowledgeBase();
    expect(kb.sessionId).toBeDefined();
  });

  it('accepts custom sessionId', () => {
    const kb = new KnowledgeBase({ sessionId: 'my-kb' });
    expect(kb.sessionId).toBe('my-kb');
  });

  it('starts empty', () => {
    const kb = new KnowledgeBase();
    expect(kb.getChunkCount()).toBe(0);
  });

  describe('addChunk', () => {
    it('adds a new chunk and returns true', () => {
      const kb = new KnowledgeBase();
      const chunk = makeChunk('hello');
      expect(kb.addChunk(chunk)).toBe(true);
      expect(kb.getChunkCount()).toBe(1);
    });

    it('rejects duplicate content and returns false', () => {
      const kb = new KnowledgeBase();
      const a = makeChunk('same content');
      const b = makeChunk('same content');
      expect(kb.addChunk(a)).toBe(true);
      expect(kb.addChunk(b)).toBe(false);
      expect(kb.getChunkCount()).toBe(1);
    });

    it('allows different content', () => {
      const kb = new KnowledgeBase();
      expect(kb.addChunk(makeChunk('alpha'))).toBe(true);
      expect(kb.addChunk(makeChunk('beta'))).toBe(true);
      expect(kb.getChunkCount()).toBe(2);
    });

    it('emits ContentIndexedEvent on add', () => {
      const kb = new KnowledgeBase({ sessionId: 'kb-1' });
      const chunk = makeChunk('content');
      kb.addChunk(chunk);
      const events = kb.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('context.content_indexed');
      const event = events[0] as any;
      expect(event.sessionId).toBe('kb-1');
      expect(event.chunkId).toBe(chunk.chunkId);
      expect(event.tokenCount).toBe(chunk.tokenCount);
    });

    it('does not emit event on duplicate', () => {
      const kb = new KnowledgeBase();
      kb.addChunk(makeChunk('dup'));
      kb.pullEvents(); // drain
      kb.addChunk(makeChunk('dup'));
      expect(kb.pullEvents()).toHaveLength(0);
    });
  });

  describe('hasContent', () => {
    it('returns true for added content hash', () => {
      const kb = new KnowledgeBase();
      const chunk = makeChunk('check');
      kb.addChunk(chunk);
      expect(kb.hasContent(chunk.contentHash)).toBe(true);
    });

    it('returns false for unknown hash', () => {
      const kb = new KnowledgeBase();
      expect(kb.hasContent('nonexistent')).toBe(false);
    });
  });

  describe('evictExpired', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts chunks past TTL', () => {
      const kb = new KnowledgeBase({ evictionTtlMs: 5000 });
      kb.addChunk(makeChunk('old'));
      kb.pullEvents();
      vi.advanceTimersByTime(5001);
      const evicted = kb.evictExpired();
      expect(evicted).toBe(1);
      expect(kb.getChunkCount()).toBe(0);
    });

    it('keeps non-expired chunks', () => {
      const kb = new KnowledgeBase({ evictionTtlMs: 5000 });
      kb.addChunk(makeChunk('fresh'));
      vi.advanceTimersByTime(3000);
      expect(kb.evictExpired()).toBe(0);
      expect(kb.getChunkCount()).toBe(1);
    });

    it('emits ChunksEvictedEvent when evicting', () => {
      const kb = new KnowledgeBase({ sessionId: 'kb-ev', evictionTtlMs: 1000 });
      kb.addChunk(makeChunk('a'));
      kb.addChunk(makeChunk('b'));
      kb.pullEvents();
      vi.advanceTimersByTime(1001);
      kb.evictExpired();
      const events = kb.pullEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('context.chunks_evicted');
      const event = events[0] as any;
      expect(event.evictedCount).toBe(2);
      expect(event.remainingCount).toBe(0);
    });

    it('does not emit event when nothing evicted', () => {
      const kb = new KnowledgeBase({ evictionTtlMs: 10000 });
      kb.addChunk(makeChunk('fresh'));
      kb.pullEvents();
      kb.evictExpired();
      expect(kb.pullEvents()).toHaveLength(0);
    });

    it('allows re-adding content after eviction', () => {
      const kb = new KnowledgeBase({ evictionTtlMs: 1000 });
      kb.addChunk(makeChunk('reuse'));
      vi.advanceTimersByTime(1001);
      kb.evictExpired();
      expect(kb.addChunk(makeChunk('reuse'))).toBe(true);
      expect(kb.getChunkCount()).toBe(1);
    });
  });

  describe('pullEvents', () => {
    it('drains the queue', () => {
      const kb = new KnowledgeBase();
      kb.addChunk(makeChunk('x'));
      kb.addChunk(makeChunk('y'));
      expect(kb.pullEvents()).toHaveLength(2);
      expect(kb.pullEvents()).toHaveLength(0);
    });
  });
});
