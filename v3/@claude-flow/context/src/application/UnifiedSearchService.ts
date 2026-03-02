/**
 * UnifiedSearchService — Combines FTS5 keyword search with optional
 * HNSW semantic search using Reciprocal Rank Fusion (RRF).
 *
 * RRF formula: score(d) = Σ 1/(k + rank_i)  where k=60
 *
 * This lets us blend keyword precision with semantic recall into a
 * single ranked result list, gracefully degrading to keyword-only
 * when no HNSW adapter is available.
 *
 * @see ADR-059a §4.4
 */

import { SearchQuery } from '../domain/value-objects/SearchQuery.js';
import {
  FuzzySearchService,
  type SearchResult,
} from './FuzzySearchService.js';

// ─── Interfaces ─────────────────────────────────────────────────────

export interface SemanticSearchResult {
  content: string;
  score: number;
  source?: string;
  matchLayer: 'semantic';
}

export interface IHNSWAdapter {
  semanticSearch(
    query: string,
    limit: number,
  ): Promise<SemanticSearchResult[]>;
}

export interface UnifiedSearchOptions {
  limit?: number;
  keywordWeight?: number;
  semanticWeight?: number;
}

export interface UnifiedSearchResult {
  content: string;
  heading: string;
  source: string;
  score: number;
  matchLayers: string[];
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_LIMIT = 10;
const RRF_K = 60;

// ─── Implementation ─────────────────────────────────────────────────

export class UnifiedSearchService {
  constructor(
    private readonly fuzzySearch: FuzzySearchService,
    private readonly hnswAdapter?: IHNSWAdapter,
  ) {}

  async search(
    queries: string[],
    options?: UnifiedSearchOptions,
  ): Promise<UnifiedSearchResult[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;

    // Run all keyword searches in parallel
    const keywordPromises = queries.map((q) => {
      const sq = SearchQuery.create(q);
      return this.fuzzySearch.search(sq, { limit });
    });

    // Run semantic searches in parallel (if adapter available)
    const semanticPromises = this.hnswAdapter
      ? queries.map((q) => this.hnswAdapter!.semanticSearch(q, limit))
      : [];

    const [keywordResults, semanticResults] = await Promise.all([
      Promise.all(keywordPromises),
      Promise.all(semanticPromises),
    ]);

    // Build fusion map keyed by content hash (first 100 chars as proxy)
    const fusionMap = new Map<
      string,
      {
        content: string;
        heading: string;
        source: string;
        rrfScore: number;
        layers: Set<string>;
      }
    >();

    // Process keyword results
    for (const results of keywordResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const r = results[rank];
        const key = this.contentKey(r.content);
        const existing = fusionMap.get(key);
        const rrfContribution = 1 / (RRF_K + rank + 1);

        if (existing) {
          existing.rrfScore += rrfContribution;
          existing.layers.add(r.matchLayer);
        } else {
          fusionMap.set(key, {
            content: r.content,
            heading: r.heading,
            source: r.source,
            rrfScore: rrfContribution,
            layers: new Set([r.matchLayer]),
          });
        }
      }
    }

    // Process semantic results
    for (const results of semanticResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const r = results[rank];
        const key = this.contentKey(r.content);
        const existing = fusionMap.get(key);
        const rrfContribution = 1 / (RRF_K + rank + 1);

        if (existing) {
          existing.rrfScore += rrfContribution;
          existing.layers.add('semantic');
        } else {
          fusionMap.set(key, {
            content: r.content,
            heading: '',
            source: r.source ?? '',
            rrfScore: rrfContribution,
            layers: new Set(['semantic']),
          });
        }
      }
    }

    // Sort by RRF score descending and return top N
    const sorted = [...fusionMap.values()]
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, limit);

    return sorted.map((entry) => ({
      content: entry.content,
      heading: entry.heading,
      source: entry.source,
      score: entry.rrfScore,
      matchLayers: [...entry.layers],
    }));
  }

  private contentKey(content: string): string {
    return content.slice(0, 100);
  }
}
