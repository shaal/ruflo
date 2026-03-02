/**
 * UnifiedSearchService tests — RRF fusion of keyword + semantic results.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnifiedSearchService,
  type IHNSWAdapter,
} from '../../src/application/UnifiedSearchService.js';
import {
  FuzzySearchService,
  type IFTS5Repo,
  type ILevenshteinCorrector,
} from '../../src/application/FuzzySearchService.js';

// ─── Helpers ────────────────────────────────────────────────────────

function createFuzzyMocks() {
  const fts5Repo: IFTS5Repo = {
    match: vi.fn().mockResolvedValue([]),
    trigramSearch: vi.fn().mockResolvedValue([]),
    getVocabulary: vi.fn().mockResolvedValue([]),
  };
  const levenshtein: ILevenshteinCorrector = {
    correct: vi.fn().mockReturnValue(null),
  };
  return { fts5Repo, levenshtein };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('UnifiedSearchService', () => {
  let fts5Repo: IFTS5Repo;
  let fuzzySearch: FuzzySearchService;

  beforeEach(() => {
    const mocks = createFuzzyMocks();
    fts5Repo = mocks.fts5Repo;
    fuzzySearch = new FuzzySearchService(fts5Repo, mocks.levenshtein);
  });

  it('should return keyword-only results when no HNSW adapter', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        chunkId: 'c1',
        content: 'auth module code',
        heading: 'Auth',
        source: 'tool1',
        rank: -2,
      },
    ]);

    const service = new UnifiedSearchService(fuzzySearch);
    const results = await service.search(['auth']);

    expect(results).toHaveLength(1);
    expect(results[0].matchLayers).toContain('stemming');
  });

  it('should combine keyword and semantic results via RRF', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        chunkId: 'c1',
        content: 'keyword match content here',
        heading: 'Keyword',
        source: 'tool1',
        rank: -2,
      },
    ]);

    const hnswAdapter: IHNSWAdapter = {
      semanticSearch: vi.fn().mockResolvedValue([
        {
          content: 'semantic match content here',
          score: 0.9,
          source: 'tool2',
          matchLayer: 'semantic' as const,
        },
      ]),
    };

    const service = new UnifiedSearchService(fuzzySearch, hnswAdapter);
    const results = await service.search(['auth']);

    expect(results.length).toBeGreaterThanOrEqual(1);
    // At least one result should exist
    const layers = results.flatMap((r) => r.matchLayers);
    expect(layers.length).toBeGreaterThanOrEqual(1);
  });

  it('should score documents appearing in both rankings higher', async () => {
    const sharedContent = 'shared content appearing in both results here';

    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        chunkId: 'c1',
        content: sharedContent,
        heading: 'Shared',
        source: 'tool1',
        rank: -3,
      },
      {
        chunkId: 'c2',
        content: 'keyword only result not in semantic',
        heading: 'Keyword Only',
        source: 'tool1',
        rank: -1,
      },
    ]);

    const hnswAdapter: IHNSWAdapter = {
      semanticSearch: vi.fn().mockResolvedValue([
        {
          content: sharedContent,
          score: 0.95,
          source: 'tool1',
          matchLayer: 'semantic' as const,
        },
      ]),
    };

    const service = new UnifiedSearchService(fuzzySearch, hnswAdapter);
    const results = await service.search(['test']);

    // The shared content should rank higher (appears in both)
    expect(results[0].content).toBe(sharedContent);
    expect(results[0].matchLayers).toContain('stemming');
    expect(results[0].matchLayers).toContain('semantic');
  });

  it('should handle multiple queries', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        chunkId: 'c1',
        content: 'result for query content goes here',
        heading: 'Result',
        source: 'tool1',
        rank: -1,
      },
    ]);

    const service = new UnifiedSearchService(fuzzySearch);
    const results = await service.search(['query1', 'query2']);

    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty array when no results from any source', async () => {
    const service = new UnifiedSearchService(fuzzySearch);
    const results = await service.search(['nonexistent']);

    expect(results).toHaveLength(0);
  });

  it('should respect limit option', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      chunkId: `c${i}`,
      content: `result number ${i} with unique content padding`,
      heading: `H${i}`,
      source: 'tool1',
      rank: -(i + 1),
    }));
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue(many);

    const service = new UnifiedSearchService(fuzzySearch);
    const results = await service.search(['test'], { limit: 3 });

    expect(results).toHaveLength(3);
  });
});
