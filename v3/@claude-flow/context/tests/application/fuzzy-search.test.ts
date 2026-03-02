/**
 * FuzzySearchService tests — Three-layer cascade with mocked deps.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FuzzySearchService,
  type IFTS5Repo,
  type ILevenshteinCorrector,
  type ISearchQuery,
} from '../../src/application/FuzzySearchService.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeQuery(raw: string): ISearchQuery {
  const normalized = raw.toLowerCase().trim();
  const tokens = normalized.split(/\s+/).filter((t) => t.length > 0);
  return {
    getRaw: () => raw,
    getNormalized: () => normalized,
    getTokens: () => tokens,
    toFTS5Match: () => tokens.join(' AND '),
    toTrigramPattern: () => normalized,
  };
}

function makeResult(id: string, content: string) {
  return {
    chunkId: id,
    content,
    heading: 'Test Heading',
    source: 'test-tool',
    rank: -1,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('FuzzySearchService', () => {
  let fts5Repo: IFTS5Repo;
  let levenshtein: ILevenshteinCorrector;
  let service: FuzzySearchService;

  beforeEach(() => {
    fts5Repo = {
      match: vi.fn().mockResolvedValue([]),
      trigramSearch: vi.fn().mockResolvedValue([]),
      getVocabulary: vi.fn().mockResolvedValue([]),
    };
    levenshtein = {
      correct: vi.fn().mockReturnValue(null),
    };
    service = new FuzzySearchService(fts5Repo, levenshtein);
  });

  it('should return Layer 1 (stemming) results when FTS5 matches', async () => {
    const results = [makeResult('c1', 'auth module')];
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const found = await service.search(makeQuery('auth'));

    expect(found).toHaveLength(1);
    expect(found[0].matchLayer).toBe('stemming');
    expect(found[0].chunkId).toBe('c1');
  });

  it('should fall through to Layer 2 (trigram) when stemming fails', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const trigramResults = [makeResult('c2', 'authentication service')];
    (fts5Repo.trigramSearch as ReturnType<typeof vi.fn>).mockResolvedValue(
      trigramResults,
    );

    const found = await service.search(makeQuery('authe'));

    expect(found).toHaveLength(1);
    expect(found[0].matchLayer).toBe('trigram');
    expect(fts5Repo.match).toHaveBeenCalled();
    expect(fts5Repo.trigramSearch).toHaveBeenCalled();
  });

  it('should fall through to Layer 3 (fuzzy) when trigram fails', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fts5Repo.trigramSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fts5Repo.getVocabulary as ReturnType<typeof vi.fn>).mockResolvedValue([
      'authentication',
    ]);
    (levenshtein.correct as ReturnType<typeof vi.fn>).mockReturnValue(
      'authentication',
    );

    // After correction, the re-search returns results
    (fts5Repo.match as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // first call (Layer 1)
      .mockResolvedValueOnce([makeResult('c3', 'auth corrected')]); // re-search

    const found = await service.search(makeQuery('authentcation'));

    expect(found).toHaveLength(1);
    expect(found[0].matchLayer).toBe('fuzzy');
    expect(found[0].correctedQuery).toBeDefined();
  });

  it('should return empty when nothing matches at any layer', async () => {
    const found = await service.search(makeQuery('nonexistent'));

    expect(found).toHaveLength(0);
  });

  it('should respect limit option', async () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      makeResult(`c${i}`, `result ${i}`),
    );
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue(results);

    const found = await service.search(makeQuery('test'), { limit: 5 });

    expect(found).toHaveLength(5);
  });

  it('should not attempt Levenshtein when no corrections found', async () => {
    (fts5Repo.match as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (fts5Repo.trigramSearch as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (levenshtein.correct as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const found = await service.search(makeQuery('zzzzz'));

    expect(found).toHaveLength(0);
    // match should only have been called once (Layer 1), not re-searched
    expect(fts5Repo.match).toHaveBeenCalledTimes(1);
  });
});
