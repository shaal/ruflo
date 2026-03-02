/**
 * OutputCompressedEvent — emitted when tool output is compressed.
 */
import { type DomainEvent } from './DomainEvent.js';

export interface OutputCompressedEvent extends DomainEvent {
  readonly type: 'context.output_compressed';
  readonly sessionId: string;
  readonly toolName: string;
  readonly rawSize: number;
  readonly compressedSize: number;
  readonly ratio: number;
}

export function createOutputCompressedEvent(params: {
  sessionId: string;
  toolName: string;
  rawSize: number;
  compressedSize: number;
  ratio: number;
}): OutputCompressedEvent {
  return {
    type: 'context.output_compressed',
    occurredAt: new Date(),
    ...params,
  };
}
