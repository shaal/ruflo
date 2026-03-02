/**
 * FTS5Repository Tests
 *
 * Validates BM25-ranked search, trigram substring matching,
 * vocabulary extraction, eviction, and lifecycle operations.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import {
  FTS5Repository,
  type KnowledgeChunkInput,
} from '../../src/infrastructure/FTS5Repository.js';

describe('FTS5Repository', () => {
  let SQL: Awaited<ReturnType<typeof initSqlJs>>;
  let db: Database;
  let repo: FTS5Repository;

  beforeAll(async () => {
    SQL = await initSqlJs();
  });

  beforeEach(async () => {
    db = new SQL.Database();
    repo = new FTS5Repository(db);
    await repo.init();
  });

  afterAll(() => {
    // SQL module cleanup not needed; individual DBs are closed in afterEach via repo
  });

  function makeChunk(overrides: Partial<KnowledgeChunkInput> = {}): KnowledgeChunkInput {
    return {
      chunkId: overrides.chunkId ?? `chunk-${Math.random().toString(36).slice(2, 8)}`,
      content: overrides.content ?? 'Default content for testing',
      heading: overrides.heading ?? 'Test Heading',
      source: overrides.source ?? 'test-tool',
      sessionId: overrides.sessionId ?? 'session-1',
      contentHash: overrides.contentHash ?? 'hash-' + Math.random().toString(36).slice(2, 8),
      createdAt: overrides.createdAt ?? new Date(),
      tokenCount: overrides.tokenCount ?? 10,
    };
  }

  describe('init()', () => {
    it('should create FTS5 tables on initialization', async () => {
      // Tables were created in beforeEach, verify by querying
      const count = await repo.count();
      expect(count).toBe(0);
    });

    it('should be idempotent', async () => {
      // Second init should not throw
      await repo.init();
      const count = await repo.count();
      expect(count).toBe(0);
    });

    it('should throw if methods called before init', async () => {
      const freshDb = new SQL.Database();
      const freshRepo = new FTS5Repository(freshDb);

      await expect(freshRepo.count()).rejects.toThrow('not initialized');
      freshDb.close();
    });
  });

  describe('insert()', () => {
    it('should insert a chunk and be retrievable via count', async () => {
      await repo.insert(makeChunk({ content: 'TypeScript generics tutorial' }));
      expect(await repo.count()).toBe(1);
    });

    it('should insert multiple chunks', async () => {
      await repo.insert(makeChunk({ chunkId: 'c1', content: 'First chunk' }));
      await repo.insert(makeChunk({ chunkId: 'c2', content: 'Second chunk' }));
      await repo.insert(makeChunk({ chunkId: 'c3', content: 'Third chunk' }));
      expect(await repo.count()).toBe(3);
    });
  });

  describe('match()', () => {
    it('should return BM25-ranked results for matching queries', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'auth-1',
          content: 'OAuth authentication with JWT tokens for secure API access',
          heading: 'Authentication',
        }),
      );
      await repo.insert(
        makeChunk({
          chunkId: 'react-1',
          content: 'React hooks for managing component state and lifecycle',
          heading: 'React Hooks',
        }),
      );

      const results = await repo.match('authentication');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].chunkId).toBe('auth-1');
      expect(results[0].content).toContain('authentication');
      expect(typeof results[0].rank).toBe('number');
    });

    it('should rank more relevant results higher', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'dense',
          content: 'kubernetes kubernetes kubernetes deployment configuration kubernetes cluster',
        }),
      );
      await repo.insert(
        makeChunk({
          chunkId: 'sparse',
          content: 'Setting up a basic kubernetes cluster is straightforward',
        }),
      );

      const results = await repo.match('kubernetes');
      expect(results.length).toBe(2);
      // FTS5 BM25 returns negative scores, more negative = better match
      // The denser match should have a more negative (better) rank
      expect(results[0].rank).toBeLessThanOrEqual(results[1].rank);
    });

    it('should return empty array for empty query', async () => {
      await repo.insert(makeChunk({ content: 'something' }));
      expect(await repo.match('')).toEqual([]);
      expect(await repo.match('   ')).toEqual([]);
    });

    it('should return empty array when no matches', async () => {
      await repo.insert(makeChunk({ content: 'Hello world' }));
      const results = await repo.match('xylophone');
      expect(results).toEqual([]);
    });

    it('should handle Porter stemming (run matches running)', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'stem-1',
          content: 'The application is running smoothly on production servers',
        }),
      );

      const results = await repo.match('run');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].chunkId).toBe('stem-1');
    });
  });

  describe('trigramSearch()', () => {
    it('should find substring matches', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'hook-1',
          content: 'useEffect is a React hook for side effects',
          heading: 'React Hooks',
        }),
      );

      const results = await repo.trigramSearch('useEff');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].content).toContain('useEffect');
    });

    it('should return empty for very short patterns (< 3 chars)', async () => {
      await repo.insert(makeChunk({ content: 'something' }));
      expect(await repo.trigramSearch('ab')).toEqual([]);
      expect(await repo.trigramSearch('')).toEqual([]);
    });

    it('should join heading and source from primary table', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'joined-1',
          content: 'configureStore creates a Redux store',
          heading: 'Redux Setup',
          source: 'docs/redux.md',
        }),
      );

      const results = await repo.trigramSearch('configureStore');
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].heading).toBe('Redux Setup');
      expect(results[0].source).toBe('docs/redux.md');
    });
  });

  describe('getVocabulary()', () => {
    it('should extract unique terms from indexed content', async () => {
      await repo.insert(
        makeChunk({
          content: 'TypeScript interfaces provide strong type safety',
        }),
      );

      const vocab = await repo.getVocabulary();
      expect(vocab.length).toBeGreaterThan(0);
      // Porter stemmer may reduce "interfaces" to "interfac" or similar
      expect(vocab.some((t) => t.startsWith('typescript') || t === 'typescript')).toBe(true);
    });

    it('should return empty array when no chunks exist', async () => {
      const vocab = await repo.getVocabulary();
      expect(vocab).toEqual([]);
    });
  });

  describe('evict()', () => {
    it('should evict rows matching the predicate', async () => {
      await repo.insert(makeChunk({ chunkId: 'keep-1', sessionId: 'session-a' }));
      await repo.insert(makeChunk({ chunkId: 'evict-1', sessionId: 'session-b' }));
      await repo.insert(makeChunk({ chunkId: 'evict-2', sessionId: 'session-b' }));

      const evicted = await repo.evict((row) => row.sessionId === 'session-b');
      expect(evicted).toBe(2);
      expect(await repo.count()).toBe(1);
    });

    it('should evict from both chunks and vocabulary tables', async () => {
      await repo.insert(
        makeChunk({
          chunkId: 'trig-evict',
          content: 'configureStore for Redux',
          sessionId: 'to-delete',
        }),
      );

      await repo.evict((row) => row.sessionId === 'to-delete');

      // Substring search should also return nothing now
      const results = await repo.trigramSearch('configureStore');
      expect(results).toEqual([]);

      // Word search should also return nothing
      const matchResults = await repo.match('redux');
      expect(matchResults).toEqual([]);
    });

    it('should return 0 when no rows match', async () => {
      await repo.insert(makeChunk({ sessionId: 'keep-me' }));
      const evicted = await repo.evict((row) => row.sessionId === 'nonexistent');
      expect(evicted).toBe(0);
      expect(await repo.count()).toBe(1);
    });
  });

  describe('evictBySession()', () => {
    it('should evict expired chunks for a given session', async () => {
      const oldDate = new Date(Date.now() - 60_000); // 60 seconds ago
      const recentDate = new Date();

      await repo.insert(
        makeChunk({ chunkId: 'old-1', sessionId: 'sess-x', createdAt: oldDate }),
      );
      await repo.insert(
        makeChunk({ chunkId: 'recent-1', sessionId: 'sess-x', createdAt: recentDate }),
      );

      // TTL of 30 seconds — the old chunk should be evicted
      const evicted = await repo.evictBySession('sess-x', 30_000);
      expect(evicted).toBe(1);
      expect(await repo.count()).toBe(1);
    });

    it('should not evict chunks from other sessions', async () => {
      const oldDate = new Date(Date.now() - 60_000);

      await repo.insert(
        makeChunk({ chunkId: 'other-1', sessionId: 'sess-other', createdAt: oldDate }),
      );

      const evicted = await repo.evictBySession('sess-target', 30_000);
      expect(evicted).toBe(0);
      expect(await repo.count()).toBe(1);
    });
  });

  describe('count()', () => {
    it('should return 0 for empty repository', async () => {
      expect(await repo.count()).toBe(0);
    });

    it('should return accurate count after insertions', async () => {
      for (let i = 0; i < 5; i++) {
        await repo.insert(makeChunk({ chunkId: `count-${i}` }));
      }
      expect(await repo.count()).toBe(5);
    });
  });

  describe('clear()', () => {
    it('should delete all rows from both tables', async () => {
      await repo.insert(makeChunk({ chunkId: 'clear-1', content: 'useCallback hook' }));
      await repo.insert(makeChunk({ chunkId: 'clear-2', content: 'useMemo hook' }));

      await repo.clear();

      expect(await repo.count()).toBe(0);
      expect(await repo.match('hook')).toEqual([]);
      expect(await repo.trigramSearch('useCallback')).toEqual([]);
    });
  });

  describe('close()', () => {
    it('should close the database when repo owns it', async () => {
      const ownedRepo = new FTS5Repository();
      await ownedRepo.init();
      await ownedRepo.insert(makeChunk({ content: 'test' }));

      // Should not throw
      ownedRepo.close();
    });
  });

  describe('FTS5 query sanitization', () => {
    it('should handle queries with special characters safely', async () => {
      await repo.insert(makeChunk({ content: 'error handling in production' }));

      // These should not throw despite containing FTS5 operators
      const results = await repo.match('error* OR handling');
      expect(Array.isArray(results)).toBe(true);

      const results2 = await repo.match('"quoted phrase"');
      expect(Array.isArray(results2)).toBe(true);
    });
  });
});
