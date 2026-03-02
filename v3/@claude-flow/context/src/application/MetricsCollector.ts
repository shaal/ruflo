/**
 * MetricsCollector — Per-tool and per-session compression/search metrics.
 *
 * Tracks compression ratios by tool name, search latencies, and
 * overall session statistics for observability dashboards.
 *
 * @see ADR-059
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface ToolMetrics {
  readonly toolName: string;
  readonly invocations: number;
  readonly totalRawBytes: number;
  readonly totalCompressedBytes: number;
  readonly avgRatio: number;
}

export interface SearchMetrics {
  readonly totalQueries: number;
  readonly totalResults: number;
  readonly avgDurationMs: number;
}

export interface SessionMetrics {
  readonly totalCompressions: number;
  readonly totalRawBytes: number;
  readonly totalCompressedBytes: number;
  readonly overallRatio: number;
  readonly tools: readonly ToolMetrics[];
  readonly search: SearchMetrics;
}

// ─── Internal accumulators ──────────────────────────────────────────

interface ToolAccumulator {
  invocations: number;
  totalRaw: number;
  totalCompressed: number;
}

// ─── Implementation ─────────────────────────────────────────────────

export class MetricsCollector {
  private readonly toolMap = new Map<string, ToolAccumulator>();
  private totalQueries = 0;
  private totalResults = 0;
  private totalSearchDurationMs = 0;

  recordCompression(
    toolName: string,
    rawSize: number,
    compressedSize: number,
  ): void {
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
  }

  recordSearch(
    queryCount: number,
    resultCount: number,
    durationMs: number,
  ): void {
    this.totalQueries += queryCount;
    this.totalResults += resultCount;
    this.totalSearchDurationMs += durationMs;
  }

  getToolStats(toolName: string): ToolMetrics {
    const acc = this.toolMap.get(toolName);
    if (!acc) {
      return {
        toolName,
        invocations: 0,
        totalRawBytes: 0,
        totalCompressedBytes: 0,
        avgRatio: 0,
      };
    }
    return {
      toolName,
      invocations: acc.invocations,
      totalRawBytes: acc.totalRaw,
      totalCompressedBytes: acc.totalCompressed,
      avgRatio:
        acc.totalRaw === 0
          ? 0
          : 1 - acc.totalCompressed / acc.totalRaw,
    };
  }

  getSessionStats(): SessionMetrics {
    let totalRaw = 0;
    let totalCompressed = 0;
    let totalCompressions = 0;

    const tools: ToolMetrics[] = [];
    for (const [toolName, acc] of this.toolMap) {
      totalRaw += acc.totalRaw;
      totalCompressed += acc.totalCompressed;
      totalCompressions += acc.invocations;
      tools.push({
        toolName,
        invocations: acc.invocations,
        totalRawBytes: acc.totalRaw,
        totalCompressedBytes: acc.totalCompressed,
        avgRatio:
          acc.totalRaw === 0
            ? 0
            : 1 - acc.totalCompressed / acc.totalRaw,
      });
    }

    return {
      totalCompressions,
      totalRawBytes: totalRaw,
      totalCompressedBytes: totalCompressed,
      overallRatio: totalRaw === 0 ? 0 : 1 - totalCompressed / totalRaw,
      tools,
      search: {
        totalQueries: this.totalQueries,
        totalResults: this.totalResults,
        avgDurationMs:
          this.totalQueries === 0
            ? 0
            : Math.round(this.totalSearchDurationMs / this.totalQueries),
      },
    };
  }

  reset(): void {
    this.toolMap.clear();
    this.totalQueries = 0;
    this.totalResults = 0;
    this.totalSearchDurationMs = 0;
  }
}
