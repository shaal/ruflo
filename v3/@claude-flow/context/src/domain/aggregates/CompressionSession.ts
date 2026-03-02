/**
 * CompressionSession — Aggregate root tracking per-session compression stats.
 *
 * Identity: sessionId.
 * Collects OutputCompressedEvent domain events via pullEvents().
 */
import { randomUUID } from 'crypto';
import { CompressionRatio } from '../value-objects/CompressionRatio.js';
import { type DomainEvent } from '../events/DomainEvent.js';
import { createOutputCompressedEvent, type OutputCompressedEvent } from '../events/OutputCompressedEvent.js';

export interface ToolCompressionStats {
  readonly toolName: string;
  readonly invocations: number;
  readonly totalRawBytes: number;
  readonly totalCompressedBytes: number;
  readonly ratio: CompressionRatio;
}

export interface SessionCompressionStats {
  readonly sessionId: string;
  readonly totalRawBytes: number;
  readonly totalCompressedBytes: number;
  readonly overallRatio: CompressionRatio;
  readonly toolStats: readonly ToolCompressionStats[];
}

interface ToolAccumulator {
  invocations: number;
  totalRaw: number;
  totalCompressed: number;
}

export class CompressionSession {
  readonly sessionId: string;
  private totalRawBytes = 0;
  private totalCompressedBytes = 0;
  private readonly toolMap = new Map<string, ToolAccumulator>();
  private readonly pendingEvents: DomainEvent[] = [];

  constructor(sessionId?: string) {
    this.sessionId = sessionId ?? randomUUID();
  }

  /**
   * Record a compression result for a tool invocation.
   * Emits an OutputCompressedEvent.
   */
  recordCompression(toolName: string, rawSize: number, compressedSize: number): void {
    if (rawSize < 0 || compressedSize < 0) {
      throw new RangeError('Sizes must be non-negative');
    }
    if (compressedSize > rawSize) {
      throw new RangeError('compressedSize cannot exceed rawSize');
    }

    this.totalRawBytes += rawSize;
    this.totalCompressedBytes += compressedSize;

    const existing = this.toolMap.get(toolName);
    if (existing) {
      existing.invocations++;
      existing.totalRaw += rawSize;
      existing.totalCompressed += compressedSize;
    } else {
      this.toolMap.set(toolName, {
        invocations: 1,
        totalRaw: rawSize,
        totalCompressed: compressedSize,
      });
    }

    const ratio = rawSize === 0 ? 0 : 1 - compressedSize / rawSize;
    const event: OutputCompressedEvent = createOutputCompressedEvent({
      sessionId: this.sessionId,
      toolName,
      rawSize,
      compressedSize,
      ratio,
    });
    this.pendingEvents.push(event);
  }

  /** Overall compression ratio across all tools. */
  getOverallRatio(): CompressionRatio {
    if (this.totalRawBytes === 0) return CompressionRatio.none();
    return CompressionRatio.create(this.totalRawBytes, this.totalCompressedBytes);
  }

  /** Full session statistics snapshot. */
  getStats(): SessionCompressionStats {
    const toolStats: ToolCompressionStats[] = [];
    for (const [toolName, acc] of this.toolMap) {
      toolStats.push({
        toolName,
        invocations: acc.invocations,
        totalRawBytes: acc.totalRaw,
        totalCompressedBytes: acc.totalCompressed,
        ratio:
          acc.totalRaw === 0
            ? CompressionRatio.none()
            : CompressionRatio.create(acc.totalRaw, acc.totalCompressed),
      });
    }
    return {
      sessionId: this.sessionId,
      totalRawBytes: this.totalRawBytes,
      totalCompressedBytes: this.totalCompressedBytes,
      overallRatio: this.getOverallRatio(),
      toolStats,
    };
  }

  /** Drain and return all pending domain events. */
  pullEvents(): DomainEvent[] {
    const events = [...this.pendingEvents];
    this.pendingEvents.length = 0;
    return events;
  }
}
