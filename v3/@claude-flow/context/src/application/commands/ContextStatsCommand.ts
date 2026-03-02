/**
 * ContextStatsCommand — Formats compression session stats
 * as a readable table for CLI/dashboard output.
 */

export interface ISessionStats {
  sessionId: string;
  totalRawBytes: number;
  totalCompressedBytes: number;
  overallRatio: { getPercentage(): number };
  toolStats: ReadonlyArray<{
    toolName: string;
    invocations: number;
    totalRawBytes: number;
    totalCompressedBytes: number;
    ratio: { getPercentage(): number };
  }>;
}

export async function contextStats(session: ISessionStats): Promise<string> {
  const lines: string[] = [];

  lines.push('Context Compression Statistics');
  lines.push('═'.repeat(50));
  lines.push(`Session: ${session.sessionId}`);
  lines.push(`Total Raw:        ${formatBytes(session.totalRawBytes)}`);
  lines.push(`Total Compressed: ${formatBytes(session.totalCompressedBytes)}`);
  lines.push(
    `Overall Ratio:    ${session.overallRatio.getPercentage().toFixed(1)}%`,
  );
  lines.push('');

  if (session.toolStats.length > 0) {
    lines.push('Per-Tool Breakdown');
    lines.push('─'.repeat(50));
    lines.push(
      padRight('Tool', 20) +
        padRight('Calls', 8) +
        padRight('Raw', 10) +
        padRight('Comp', 10) +
        'Ratio',
    );
    lines.push('─'.repeat(50));

    for (const ts of session.toolStats) {
      lines.push(
        padRight(ts.toolName, 20) +
          padRight(String(ts.invocations), 8) +
          padRight(formatBytes(ts.totalRawBytes), 10) +
          padRight(formatBytes(ts.totalCompressedBytes), 10) +
          `${ts.ratio.getPercentage().toFixed(1)}%`,
      );
    }
  } else {
    lines.push('No tool compressions recorded yet.');
  }

  return lines.join('\n');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}
