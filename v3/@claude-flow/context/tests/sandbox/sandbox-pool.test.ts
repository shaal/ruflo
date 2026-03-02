import { describe, it, expect, afterEach } from 'vitest';
import { SandboxPool } from '../../src/sandbox/SandboxPool.js';

describe('SandboxPool', () => {
  let pool: SandboxPool;

  afterEach(async () => {
    if (pool) {
      await pool.drain();
    }
  });

  describe('execute — basic runtimes', () => {
    it('should execute simple JS code', async () => {
      pool = new SandboxPool();
      const result = await pool.execute(
        'console.log("hello")',
        'javascript',
      );

      expect(result.stdout.trim()).toBe('hello');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.truncated).toBe(false);
    });

    it('should execute Python code', async () => {
      pool = new SandboxPool();
      const result = await pool.execute('print(1+1)', 'python');

      expect(result.stdout.trim()).toBe('2');
      expect(result.exitCode).toBe(0);
    });

    it('should execute shell code', async () => {
      pool = new SandboxPool();
      const result = await pool.execute('echo test', 'shell');

      expect(result.stdout.trim()).toBe('test');
      expect(result.exitCode).toBe(0);
    });

    it('should capture stderr', async () => {
      pool = new SandboxPool();
      const result = await pool.execute(
        'console.error("err-output")',
        'javascript',
      );

      expect(result.stderr).toContain('err-output');
      expect(result.exitCode).toBe(0);
    });

    it('should report non-zero exit code', async () => {
      pool = new SandboxPool();
      const result = await pool.execute('exit 42', 'shell');

      expect(result.exitCode).toBe(42);
    });

    it('should measure durationMs', async () => {
      pool = new SandboxPool();
      const result = await pool.execute('echo fast', 'shell');

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(10_000);
    });
  });

  describe('timeout enforcement', () => {
    it('should time out long-running code', async () => {
      pool = new SandboxPool();
      const result = await pool.execute('sleep 10', 'shell', {
        timeout: 1_000,
      });

      expect(result.timedOut).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(900);
      expect(result.durationMs).toBeLessThan(5_000);
    });
  });

  describe('output truncation', () => {
    it('should truncate output exceeding maxOutputSize', async () => {
      pool = new SandboxPool();
      // Generate ~1KB of output, but limit to 100 bytes
      const result = await pool.execute(
        'python3 -c "print(\'A\' * 1000)"',
        'shell',
        { maxOutputSize: 100 },
      );

      expect(result.truncated).toBe(true);
      expect(result.stdout.length).toBeLessThanOrEqual(100);
    });
  });

  describe('pool stats', () => {
    it('should track creation count', async () => {
      pool = new SandboxPool({ warmPoolSize: 0 });

      const statsBefore = pool.getStats();
      expect(statsBefore.totalCreated).toBe(0);
      expect(statsBefore.active).toBe(0);
      expect(statsBefore.warm).toBe(0);

      await pool.execute('echo hi', 'shell');

      const statsAfter = pool.getStats();
      expect(statsAfter.totalCreated).toBeGreaterThanOrEqual(1);
    });

    it('should track acquire latency', async () => {
      pool = new SandboxPool({ warmPoolSize: 0 });

      await pool.execute('echo test', 'shell');

      const stats = pool.getStats();
      expect(stats.avgAcquireMs).toBeGreaterThanOrEqual(0);
    });

    it('should track active instances during execution', async () => {
      pool = new SandboxPool({ warmPoolSize: 0 });

      // Acquire without releasing to check active count
      const instance = await pool.acquire('shell');
      const stats = pool.getStats();
      expect(stats.active).toBe(1);

      await pool.release(instance);
      const statsAfter = pool.getStats();
      expect(statsAfter.active).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent executions', async () => {
      pool = new SandboxPool({ maxConcurrent: 4, warmPoolSize: 0 });

      const results = await Promise.all([
        pool.execute('echo one', 'shell'),
        pool.execute('echo two', 'shell'),
        pool.execute('echo three', 'shell'),
      ]);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.exitCode === 0)).toBe(true);
      expect(results.map((r) => r.stdout.trim()).sort()).toEqual([
        'one',
        'three',
        'two',
      ]);
    });

    it('should reject when max concurrent is reached', async () => {
      pool = new SandboxPool({ maxConcurrent: 1, warmPoolSize: 0 });

      // Acquire one instance to fill the pool
      const inst = await pool.acquire('shell');

      await expect(pool.acquire('shell')).rejects.toThrow(
        'Max concurrent sandboxes reached',
      );

      await pool.release(inst);
    });
  });

  describe('drain', () => {
    it('should terminate all instances and prevent new acquisitions', async () => {
      pool = new SandboxPool({ warmPoolSize: 0 });

      await pool.execute('echo test', 'shell');
      await pool.drain();

      const stats = pool.getStats();
      expect(stats.warm).toBe(0);
      expect(stats.active).toBe(0);

      await expect(pool.acquire('shell')).rejects.toThrow(
        'Pool has been drained',
      );
    });

    it('should be safe to call drain multiple times', async () => {
      pool = new SandboxPool();
      await pool.drain();
      await pool.drain(); // Should not throw
    });
  });

  describe('error handling', () => {
    it('should handle code that writes to stderr', async () => {
      pool = new SandboxPool();
      const result = await pool.execute(
        'echo "error message" >&2; exit 1',
        'shell',
      );

      expect(result.stderr).toContain('error message');
      expect(result.exitCode).toBe(1);
    });

    it('should handle syntax errors gracefully', async () => {
      pool = new SandboxPool();
      const result = await pool.execute(
        'this is not valid javascript ===>>>',
        'javascript',
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });
});
