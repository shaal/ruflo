import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnowledgeChunk, type ChunkSource } from '../../src/domain/entities/KnowledgeChunk.js';
import { SandboxInstance, SandboxState } from '../../src/domain/entities/SandboxInstance.js';

describe('KnowledgeChunk', () => {
  const source: ChunkSource = {
    toolName: 'Read',
    agentId: 'agent-1',
    filePath: '/src/index.ts',
  };

  it('auto-generates chunkId and createdAt', () => {
    const chunk = new KnowledgeChunk({
      content: 'hello world',
      heading: 'Test',
      source,
      sessionId: 'session-1',
    });
    expect(chunk.chunkId).toBeDefined();
    expect(chunk.chunkId.length).toBeGreaterThan(0);
    expect(chunk.createdAt).toBeInstanceOf(Date);
  });

  it('computes contentHash as SHA-256 hex', () => {
    const chunk = new KnowledgeChunk({
      content: 'hello',
      heading: 'H',
      source,
      sessionId: 's1',
    });
    // SHA-256 of "hello" is well-known
    expect(chunk.contentHash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('estimates tokenCount as ceil(length / 4)', () => {
    const chunk = new KnowledgeChunk({
      content: 'abcdefghij', // length 10
      heading: 'H',
      source,
      sessionId: 's1',
    });
    expect(chunk.tokenCount).toBe(3); // ceil(10/4) = 3
  });

  describe('isExpired', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns false when within TTL', () => {
      const chunk = new KnowledgeChunk({
        content: 'test',
        heading: 'H',
        source,
        sessionId: 's1',
      });
      vi.advanceTimersByTime(1000);
      expect(chunk.isExpired(5000)).toBe(false);
    });

    it('returns true when past TTL', () => {
      const chunk = new KnowledgeChunk({
        content: 'test',
        heading: 'H',
        source,
        sessionId: 's1',
      });
      vi.advanceTimersByTime(5001);
      expect(chunk.isExpired(5000)).toBe(true);
    });
  });

  describe('isDuplicateOf', () => {
    it('returns true for same content', () => {
      const a = new KnowledgeChunk({
        content: 'same',
        heading: 'A',
        source,
        sessionId: 's1',
      });
      const b = new KnowledgeChunk({
        content: 'same',
        heading: 'B',
        source,
        sessionId: 's2',
      });
      expect(a.isDuplicateOf(b)).toBe(true);
    });

    it('returns false for different content', () => {
      const a = new KnowledgeChunk({
        content: 'alpha',
        heading: 'H',
        source,
        sessionId: 's1',
      });
      const b = new KnowledgeChunk({
        content: 'beta',
        heading: 'H',
        source,
        sessionId: 's1',
      });
      expect(a.isDuplicateOf(b)).toBe(false);
    });
  });

  it('accepts optional chunkId and createdAt', () => {
    const date = new Date('2025-01-01');
    const chunk = new KnowledgeChunk({
      content: 'x',
      heading: 'H',
      source,
      sessionId: 's1',
      chunkId: 'custom-id',
      createdAt: date,
    });
    expect(chunk.chunkId).toBe('custom-id');
    expect(chunk.createdAt).toBe(date);
  });
});

describe('SandboxInstance', () => {
  it('starts in IDLE state', () => {
    const sb = new SandboxInstance({ runtime: 'deno' });
    expect(sb.getState()).toBe(SandboxState.IDLE);
  });

  it('auto-generates sandboxId', () => {
    const sb = new SandboxInstance({ runtime: 'quickjs' });
    expect(sb.sandboxId).toBeDefined();
    expect(sb.sandboxId.length).toBeGreaterThan(0);
  });

  describe('lifecycle transitions', () => {
    it('IDLE → ACQUIRED → EXECUTING → release → IDLE', () => {
      const sb = new SandboxInstance({ runtime: 'wasm' });
      sb.acquire();
      expect(sb.getState()).toBe(SandboxState.ACQUIRED);
      sb.markExecuting();
      expect(sb.getState()).toBe(SandboxState.EXECUTING);
      sb.release();
      expect(sb.getState()).toBe(SandboxState.IDLE);
    });

    it('ACQUIRED → release → IDLE', () => {
      const sb = new SandboxInstance({ runtime: 'node' });
      sb.acquire();
      sb.release();
      expect(sb.getState()).toBe(SandboxState.IDLE);
    });

    it('any state → TERMINATED', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.terminate();
      expect(sb.getState()).toBe(SandboxState.TERMINATED);
    });

    it('ACQUIRED → TERMINATED', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.acquire();
      sb.terminate();
      expect(sb.getState()).toBe(SandboxState.TERMINATED);
    });
  });

  describe('invalid transitions', () => {
    it('cannot acquire from ACQUIRED', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.acquire();
      expect(() => sb.acquire()).toThrow(/must be IDLE/);
    });

    it('cannot acquire from EXECUTING', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.acquire();
      sb.markExecuting();
      expect(() => sb.acquire()).toThrow(/must be IDLE/);
    });

    it('cannot acquire from TERMINATED', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.terminate();
      expect(() => sb.acquire()).toThrow(/must be IDLE/);
    });

    it('cannot markExecuting from IDLE', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      expect(() => sb.markExecuting()).toThrow(/must be ACQUIRED/);
    });

    it('cannot release from IDLE', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      expect(() => sb.release()).toThrow(/must be ACQUIRED or EXECUTING/);
    });

    it('cannot release from TERMINATED', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.terminate();
      expect(() => sb.release()).toThrow(/must be ACQUIRED or EXECUTING/);
    });
  });

  describe('isStale', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns true when IDLE beyond timeout', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      vi.advanceTimersByTime(60001);
      expect(sb.isStale(60000)).toBe(true);
    });

    it('returns false when IDLE within timeout', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      vi.advanceTimersByTime(30000);
      expect(sb.isStale(60000)).toBe(false);
    });

    it('returns false when not IDLE', () => {
      const sb = new SandboxInstance({ runtime: 'deno' });
      sb.acquire();
      vi.advanceTimersByTime(999999);
      expect(sb.isStale(1000)).toBe(false);
    });
  });

  it('lastUsedAt updates on state changes', () => {
    vi.useFakeTimers();
    const sb = new SandboxInstance({ runtime: 'deno' });
    const t0 = sb.getLastUsedAt();
    vi.advanceTimersByTime(100);
    sb.acquire();
    expect(sb.getLastUsedAt().getTime()).toBeGreaterThan(t0.getTime());
    vi.useRealTimers();
  });

  it('pid defaults to null', () => {
    const sb = new SandboxInstance({ runtime: 'deno' });
    expect(sb.pid).toBeNull();
  });

  it('accepts pid parameter', () => {
    const sb = new SandboxInstance({ runtime: 'deno', pid: 12345 });
    expect(sb.pid).toBe(12345);
  });
});
