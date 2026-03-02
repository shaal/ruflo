/**
 * KnowledgeChunk — Entity representing a piece of indexed knowledge.
 *
 * Identity: chunkId (auto-generated UUID).
 * Content is hashed with SHA-256 for deduplication.
 */
import { createHash, randomUUID } from 'crypto';

export interface ChunkSource {
  readonly toolName: string;
  readonly agentId?: string;
  readonly url?: string;
  readonly filePath?: string;
}

export class KnowledgeChunk {
  readonly chunkId: string;
  readonly content: string;
  readonly heading: string;
  readonly source: ChunkSource;
  readonly sessionId: string;
  readonly createdAt: Date;
  readonly contentHash: string;
  readonly tokenCount: number;

  constructor(params: {
    content: string;
    heading: string;
    source: ChunkSource;
    sessionId: string;
    chunkId?: string;
    createdAt?: Date;
  }) {
    this.chunkId = params.chunkId ?? randomUUID();
    this.content = params.content;
    this.heading = params.heading;
    this.source = params.source;
    this.sessionId = params.sessionId;
    this.createdAt = params.createdAt ?? new Date();
    this.contentHash = createHash('sha256').update(params.content).digest('hex');
    this.tokenCount = Math.ceil(params.content.length / 4);
  }

  /** Whether this chunk has exceeded the given TTL in milliseconds. */
  isExpired(ttlMs: number): boolean {
    return Date.now() - this.createdAt.getTime() > ttlMs;
  }

  /** Whether this chunk has the same content (by hash) as another. */
  isDuplicateOf(other: KnowledgeChunk): boolean {
    return this.contentHash === other.contentHash;
  }
}
