/**
 * FuzzySearchService — Three-layer search coordinator.
 *
 * Cascades through search strategies with increasing tolerance:
 *   Layer 1: Stemmed word matching via FTS5 (BM25-scored)
 *   Layer 2: Trigram substring matching
 *   Layer 3: Levenshtein-corrected re-search
 *
 * Returns results annotated with the layer that produced each match.
 *
 * @see ADR-059a §4.3
 */

import type { MatchLayer } from '../domain/value-objects/SnippetWindow.js';

// ─── Interfaces ─────────────────────────────────────────────────────

export interface IFTS5Repo {
  match(query: string): Promise<RawFTSResult[]>;
  trigramSearch(pattern: string): Promise<RawFTSResult[]>;
  getVocabulary(): Promise<string[]>;
}

export interface RawFTSResult {
  chunkId: string;
  content: string;
  heading: string;
  source: string;
  rank: number;
}

export interface ILevenshteinCorrector {
  correct(
    query: string,
    vocabulary: string[],
    maxDistance?: number,
  ): string | null;
}

export interface ISearchQuery {
  getRaw(): string;
  getNormalized(): string;
  getTokens(): readonly string[];
  toFTS5Match(): string;
  toTrigramPattern(): string;
}

export interface SearchOptions {
  limit?: number;
  minRelevance?: number;
}

export interface SearchResult {
  chunkId: string;
  content: string;
  heading: string;
  source: string;
  rank: number;
  matchLayer: MatchLayer;
  correctedQuery?: string;
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_RELEVANCE = 0.1;

// ─── Implementation ─────────────────────────────────────────────────

export class FuzzySearchService {
  constructor(
    private readonly fts5Repo: IFTS5Repo,
    private readonly levenshtein: ILevenshteinCorrector,
  ) {}

  async search(
    query: ISearchQuery,
    options?: SearchOptions,
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;

    // Layer 1: Stemmed word matching (FTS5)
    const fts5Results = await this.fts5Repo.match(query.toFTS5Match());
    if (fts5Results.length > 0) {
      return this.annotate(fts5Results, 'stemming').slice(0, limit);
    }

    // Layer 2: Trigram substring matching
    const trigramResults = await this.fts5Repo.trigramSearch(
      query.toTrigramPattern(),
    );
    if (trigramResults.length > 0) {
      return this.annotate(trigramResults, 'trigram').slice(0, limit);
    }

    // Layer 3: Levenshtein correction + re-search
    const vocabulary = await this.fts5Repo.getVocabulary();
    const tokens = query.getTokens();

    const correctedTokens: string[] = [];
    let anyCorrected = false;

    for (const token of tokens) {
      const corrected = this.levenshtein.correct(token, vocabulary);
      if (corrected && corrected !== token) {
        correctedTokens.push(corrected);
        anyCorrected = true;
      } else {
        correctedTokens.push(token);
      }
    }

    if (!anyCorrected) {
      return [];
    }

    const correctedQuery = correctedTokens.join(' AND ');
    const correctedResults = await this.fts5Repo.match(correctedQuery);

    return this.annotate(correctedResults, 'fuzzy', correctedQuery).slice(
      0,
      limit,
    );
  }

  private annotate(
    raw: RawFTSResult[],
    layer: MatchLayer,
    correctedQuery?: string,
  ): SearchResult[] {
    return raw.map((r) => ({
      chunkId: r.chunkId,
      content: r.content,
      heading: r.heading,
      source: r.source,
      rank: r.rank,
      matchLayer: layer,
      ...(correctedQuery ? { correctedQuery } : {}),
    }));
  }
}
