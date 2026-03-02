/**
 * ContentIndexedEvent — emitted when a knowledge chunk is indexed.
 */
import { type DomainEvent } from './DomainEvent.js';
import { type ChunkSource } from '../entities/KnowledgeChunk.js';

export interface ContentIndexedEvent extends DomainEvent {
  readonly type: 'context.content_indexed';
  readonly sessionId: string;
  readonly chunkId: string;
  readonly source: ChunkSource;
  readonly tokenCount: number;
}

export function createContentIndexedEvent(params: {
  sessionId: string;
  chunkId: string;
  source: ChunkSource;
  tokenCount: number;
}): ContentIndexedEvent {
  return {
    type: 'context.content_indexed',
    occurredAt: new Date(),
    ...params,
  };
}
