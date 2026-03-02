/**
 * KnowledgeBase — Aggregate root managing a session's knowledge chunks.
 *
 * Identity: sessionId.
 * Deduplicates by content hash. Supports TTL-based eviction.
 * Collects ContentIndexedEvent and ChunksEvictedEvent domain events.
 */
import { randomUUID } from 'crypto';
import { KnowledgeChunk } from '../entities/KnowledgeChunk.js';
import { type DomainEvent } from '../events/DomainEvent.js';
import { createContentIndexedEvent } from '../events/ContentIndexedEvent.js';
import { createChunksEvictedEvent } from '../events/ChunksEvictedEvent.js';

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export class KnowledgeBase {
  readonly sessionId: string;
  private readonly chunks = new Map<string, KnowledgeChunk>();
  private readonly contentHashes = new Set<string>();
  private readonly evictionTtlMs: number;
  private readonly pendingEvents: DomainEvent[] = [];

  constructor(params?: { sessionId?: string; evictionTtlMs?: number }) {
    this.sessionId = params?.sessionId ?? randomUUID();
    this.evictionTtlMs = params?.evictionTtlMs ?? FOUR_HOURS_MS;
  }

  /**
   * Add a chunk. Returns true if added, false if duplicate (by content hash).
   * Emits ContentIndexedEvent on success.
   */
  addChunk(chunk: KnowledgeChunk): boolean {
    if (this.contentHashes.has(chunk.contentHash)) {
      return false;
    }
    this.chunks.set(chunk.chunkId, chunk);
    this.contentHashes.add(chunk.contentHash);

    this.pendingEvents.push(
      createContentIndexedEvent({
        sessionId: this.sessionId,
        chunkId: chunk.chunkId,
        source: chunk.source,
        tokenCount: chunk.tokenCount,
      }),
    );
    return true;
  }

  /**
   * Evict all chunks whose creation time exceeds the TTL.
   * Emits ChunksEvictedEvent if any are evicted.
   * Returns the number evicted.
   */
  evictExpired(): number {
    const toEvict: string[] = [];
    for (const [id, chunk] of this.chunks) {
      if (chunk.isExpired(this.evictionTtlMs)) {
        toEvict.push(id);
      }
    }
    for (const id of toEvict) {
      const chunk = this.chunks.get(id)!;
      this.contentHashes.delete(chunk.contentHash);
      this.chunks.delete(id);
    }
    if (toEvict.length > 0) {
      this.pendingEvents.push(
        createChunksEvictedEvent({
          sessionId: this.sessionId,
          evictedCount: toEvict.length,
          remainingCount: this.chunks.size,
        }),
      );
    }
    return toEvict.length;
  }

  /** Whether the knowledge base contains content with the given hash. */
  hasContent(hash: string): boolean {
    return this.contentHashes.has(hash);
  }

  /** Number of chunks currently stored. */
  getChunkCount(): number {
    return this.chunks.size;
  }

  /** Drain and return all pending domain events. */
  pullEvents(): DomainEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return events;
  }
}
