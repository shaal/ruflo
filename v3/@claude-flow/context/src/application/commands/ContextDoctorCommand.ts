/**
 * ContextDoctorCommand — Diagnostic health checks for the
 * context optimization subsystem.
 */

// ─── Interfaces ─────────────────────────────────────────────────────

export interface IDiagnosticFTS5 {
  count(): Promise<number>;
}

export interface IDiagnosticPool {
  getStats(): { warm: number; active: number };
}

export interface DiagnosticDeps {
  fts5Repo: IDiagnosticFTS5;
  sandboxPool: IDiagnosticPool;
}

// ─── Implementation ─────────────────────────────────────────────────

export async function contextDoctor(deps: DiagnosticDeps): Promise<string> {
  const lines: string[] = [];
  let healthy = true;

  lines.push('Context Engine Diagnostics');
  lines.push('═'.repeat(40));

  // Check FTS5
  try {
    const count = await deps.fts5Repo.count();
    lines.push(`[OK]  FTS5 Repository: ${count} chunks indexed`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`[FAIL] FTS5 Repository: ${msg}`);
    healthy = false;
  }

  // Check sandbox pool
  try {
    const stats = deps.sandboxPool.getStats();
    lines.push(
      `[OK]  Sandbox Pool: ${stats.warm} warm, ${stats.active} active`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(`[FAIL] Sandbox Pool: ${msg}`);
    healthy = false;
  }

  lines.push('');
  lines.push(healthy ? 'All checks passed.' : 'Some checks failed.');

  return lines.join('\n');
}
