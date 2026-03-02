/**
 * IFTS5Repository — Repository interface for FTS5 full-text search operations.
 *
 * Aligned with the concrete FTS5Repository in the infrastructure layer.
 * Uses simple string queries and returns RawSearchResult with BM25 rank.
 */

export interface RawSearchResult {
  readonly chunkId: string;
  readonly content: string;
  readonly heading: string;
  readonly source: string;
  readonly rank: number;
}

export interface KnowledgeChunkInput {
  readonly chunkId: string;
  readonly content: string;
  readonly heading: string;
  readonly source: string;
  readonly sessionId: string;
  readonly contentHash: string;
  readonly createdAt: Date;
  readonly tokenCount: number;
}

export interface EvictPredicate {
  (row: { chunkId: string; sessionId: string; createdAt: string }): boolean;
}

export interface IFTS5Repository {
  init(): Promise<void>;
  insert(chunk: KnowledgeChunkInput): Promise<void>;
  match(query: string): Promise<RawSearchResult[]>;
  trigramSearch(pattern: string): Promise<RawSearchResult[]>;
  getVocabulary(): Promise<string[]>;
  evict(predicate: EvictPredicate): Promise<number>;
  evictBySession(sessionId: string, ttlMs: number): Promise<number>;
  count(): Promise<number>;
  clear(): Promise<void>;
  close(): void;
}
