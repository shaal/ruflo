/**
 * ChunksEvictedEvent — emitted when expired chunks are evicted from the knowledge base.
 */
import { type DomainEvent } from './DomainEvent.js';

export interface ChunksEvictedEvent extends DomainEvent {
  readonly type: 'context.chunks_evicted';
  readonly sessionId: string;
  readonly evictedCount: number;
  readonly remainingCount: number;
}

export function createChunksEvictedEvent(params: {
  sessionId: string;
  evictedCount: number;
  remainingCount: number;
}): ChunksEvictedEvent {
  return {
    type: 'context.chunks_evicted',
    occurredAt: new Date(),
    ...params,
  };
}
