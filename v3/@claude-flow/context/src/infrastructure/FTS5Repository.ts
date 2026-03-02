/**
 * FTS5Repository — Knowledge chunk storage with full-text search.
 *
 * Uses sql.js (WASM) for persistent storage with software-based search:
 * - Layer 1: Tokenized word matching with BM25-inspired scoring
 * - Layer 2: Substring (trigram-style) matching via SQL LIKE
 * - Vocabulary extraction for Layer 3 (Levenshtein correction)
 *
 * Note: Standard sql.js WASM doesn't include FTS5 extensions, so we
 * implement search in JavaScript over regular SQL tables. This provides
 * the same API contract with cross-platform compatibility.
 *
 * @see ADR-059a §4.1
 */
import initSqlJs, { type Database } from 'sql.js';

/**
 * Shape of a knowledge chunk accepted for insertion.
 * Compatible with the domain entity KnowledgeChunk.
 */
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

/**
 * Raw search result returned from search queries.
 */
export interface RawSearchResult {
  chunkId: string;
  content: string;
  heading: string;
  source: string;
  rank: number;
}

/**
 * Predicate function for conditional eviction.
 */
export type EvictPredicate = (row: {
  chunkId: string;
  sessionId: string;
  createdAt: string;
}) => boolean;

const CREATE_CHUNKS_TABLE = `
  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    chunk_id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    heading TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;

const CREATE_CHUNKS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_chunks_session
    ON knowledge_chunks(session_id);
`;

const CREATE_VOCAB_TABLE = `
  CREATE TABLE IF NOT EXISTS knowledge_vocab (
    term TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    tf INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (term, chunk_id)
  );
`;

const CREATE_VOCAB_TERM_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_vocab_term
    ON knowledge_vocab(term);
`;

export class FTS5Repository {
  private db: Database;
  private ownsDb: boolean;
  private initialized = false;

  constructor(db?: Database) {
    if (db) {
      this.db = db;
      this.ownsDb = false;
    } else {
      this.db = undefined as unknown as Database;
      this.ownsDb = true;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.ownsDb) {
      const SQL = await initSqlJs();
      this.db = new SQL.Database();
    }

    this.db.run(CREATE_CHUNKS_TABLE);
    this.db.run(CREATE_CHUNKS_INDEX);
    this.db.run(CREATE_VOCAB_TABLE);
    this.db.run(CREATE_VOCAB_TERM_INDEX);
    this.initialized = true;
  }

  private ensureInit(): void {
    if (!this.initialized) {
      throw new Error('FTS5Repository not initialized. Call init() first.');
    }
  }

  /**
   * Insert a knowledge chunk and index its vocabulary.
   */
  async insert(chunk: KnowledgeChunkInput): Promise<void> {
    this.ensureInit();

    this.db.run(
      `INSERT OR REPLACE INTO knowledge_chunks
         (chunk_id, content, heading, source, session_id, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        chunk.chunkId,
        chunk.content,
        chunk.heading,
        chunk.source,
        chunk.sessionId,
        chunk.contentHash,
        chunk.createdAt.toISOString(),
      ],
    );

    // Tokenize and insert vocabulary entries
    const terms = this.tokenize(chunk.content);
    const tf = this.computeTermFrequencies(terms);

    for (const [term, freq] of tf.entries()) {
      this.db.run(
        `INSERT OR REPLACE INTO knowledge_vocab (term, chunk_id, tf) VALUES (?, ?, ?)`,
        [term, chunk.chunkId, freq],
      );
    }
  }

  /**
   * BM25-ranked word search (Layer 1).
   * Tokenizes the query with Porter-inspired stemming, then
   * scores each matching chunk using BM25.
   */
  async match(query: string): Promise<RawSearchResult[]> {
    this.ensureInit();

    if (!query || query.trim().length === 0) {
      return [];
    }

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    // Get total document count for IDF
    const totalDocs = await this.count();
    if (totalDocs === 0) return [];

    // Collect matching chunk IDs with BM25 scores
    const scoreMap = new Map<string, number>();

    for (const term of queryTerms) {
      // Find chunks containing this term (exact or stemmed prefix)
      const stmt = this.db.prepare(
        `SELECT chunk_id, tf FROM knowledge_vocab WHERE term = ? OR term LIKE ?`,
      );
      stmt.bind([term, term + '%']);

      const matchingChunks: Array<{ chunkId: string; tf: number }> = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        matchingChunks.push({
          chunkId: row['chunk_id'] as string,
          tf: row['tf'] as number,
        });
      }
      stmt.free();

      // IDF: log((N - n + 0.5) / (n + 0.5) + 1)
      const n = matchingChunks.length;
      const idf = Math.log((totalDocs - n + 0.5) / (n + 0.5) + 1);

      for (const { chunkId, tf } of matchingChunks) {
        // Simplified BM25: score += idf * (tf * (k1 + 1)) / (tf + k1)
        const k1 = 1.2;
        const termScore = idf * ((tf * (k1 + 1)) / (tf + k1));
        scoreMap.set(chunkId, (scoreMap.get(chunkId) ?? 0) + termScore);
      }
    }

    if (scoreMap.size === 0) return [];

    // Fetch full chunk data for matching IDs
    const results: RawSearchResult[] = [];
    for (const [chunkId, score] of scoreMap.entries()) {
      const stmt = this.db.prepare(
        `SELECT content, heading, source FROM knowledge_chunks WHERE chunk_id = ?`,
      );
      stmt.bind([chunkId]);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
          chunkId,
          content: row['content'] as string,
          heading: row['heading'] as string,
          source: row['source'] as string,
          rank: -score, // Negative so higher score = more negative = sorted first
        });
      }
      stmt.free();
    }

    // Sort by rank (most negative first = highest relevance)
    results.sort((a, b) => a.rank - b.rank);
    return results;
  }

  /**
   * Substring search (Layer 2).
   * Finds chunks whose content contains the pattern as a substring.
   */
  async trigramSearch(pattern: string): Promise<RawSearchResult[]> {
    this.ensureInit();

    if (!pattern || pattern.trim().length < 3) {
      return [];
    }

    const escaped = pattern.replace(/%/g, '\\%').replace(/_/g, '\\_');

    const stmt = this.db.prepare(
      `SELECT chunk_id, content, heading, source
       FROM knowledge_chunks
       WHERE content LIKE ? ESCAPE '\\'
       ORDER BY length(content) ASC`,
    );
    stmt.bind([`%${escaped}%`]);

    const results: RawSearchResult[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push({
        chunkId: row['chunk_id'] as string,
        content: row['content'] as string,
        heading: row['heading'] as string,
        source: row['source'] as string,
        rank: -(results.length + 1), // Simple rank ordering
      });
    }
    stmt.free();

    return results;
  }

  /**
   * Extract unique terms from the vocabulary table.
   * Used by Layer 3 (Levenshtein correction) to build a word list.
   */
  async getVocabulary(): Promise<string[]> {
    this.ensureInit();

    const stmt = this.db.prepare(
      `SELECT DISTINCT term FROM knowledge_vocab ORDER BY term`,
    );

    const terms: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      terms.push(row['term'] as string);
    }
    stmt.free();

    return terms;
  }

  /**
   * Evict rows matching a predicate from all tables.
   */
  async evict(predicate: EvictPredicate): Promise<number> {
    this.ensureInit();

    const stmt = this.db.prepare(
      `SELECT chunk_id, session_id, created_at FROM knowledge_chunks`,
    );

    const toEvict: string[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (
        predicate({
          chunkId: row['chunk_id'] as string,
          sessionId: row['session_id'] as string,
          createdAt: row['created_at'] as string,
        })
      ) {
        toEvict.push(row['chunk_id'] as string);
      }
    }
    stmt.free();

    for (const chunkId of toEvict) {
      this.db.run(`DELETE FROM knowledge_chunks WHERE chunk_id = ?`, [chunkId]);
      this.db.run(`DELETE FROM knowledge_vocab WHERE chunk_id = ?`, [chunkId]);
    }

    return toEvict.length;
  }

  /**
   * Evict chunks from a specific session that have exceeded their TTL.
   */
  async evictBySession(sessionId: string, ttlMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    return this.evict(
      (row) => row.sessionId === sessionId && row.createdAt < cutoff,
    );
  }

  /**
   * Return the total number of indexed chunks.
   */
  async count(): Promise<number> {
    this.ensureInit();

    const stmt = this.db.prepare(
      `SELECT count(*) as cnt FROM knowledge_chunks`,
    );
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row['cnt'] as number;
  }

  /**
   * Delete all rows from all tables.
   */
  async clear(): Promise<void> {
    this.ensureInit();
    this.db.run(`DELETE FROM knowledge_chunks`);
    this.db.run(`DELETE FROM knowledge_vocab`);
  }

  /**
   * Close the underlying database connection.
   */
  close(): void {
    if (this.db && this.ownsDb) {
      this.db.close();
    }
    this.initialized = false;
  }

  /**
   * Tokenize content into lowercase stemmed terms.
   * Applies basic Porter stemming (suffix removal).
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => this.stem(t));
  }

  /**
   * Basic Porter stemming — removes common English suffixes.
   */
  private stem(word: string): string {
    if (word.length <= 3) return word;

    let w = word;
    // Step 1: Common suffixes
    if (w.endsWith('ies') && w.length > 4) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('es') && w.length > 3) w = w.slice(0, -2);
    else if (w.endsWith('ss')) { /* keep */ }
    else if (w.endsWith('s') && w.length > 3) w = w.slice(0, -1);

    // Step 2: -ing, -ed, -ly
    if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
    else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);

    // Step 3: -tion, -ment, -ness, -able, -ible
    if (w.endsWith('tion') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('able') && w.length > 6) w = w.slice(0, -4);
    else if (w.endsWith('ible') && w.length > 6) w = w.slice(0, -4);

    return w;
  }

  /**
   * Compute term frequency map from a list of tokens.
   */
  private computeTermFrequencies(terms: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    return tf;
  }
}
