/**
 * SandboxPool — Pool manager for process-isolated sandbox instances.
 *
 * Uses Node.js `child_process.spawn()` for process isolation.
 * Maintains a warm pool of pre-started sandbox instances for fast acquisition.
 *
 * Lifecycle:  acquire → execute → release
 * Shutdown:   drain() terminates all instances.
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CredentialPassthrough } from './CredentialPassthrough.js';
import { RuntimeDetector, type RuntimeType } from './RuntimeDetector.js';

// ────────────────────────── Interfaces ──────────────────────────

export interface ExecOptions {
  timeout?: number;
  maxMemory?: number;
  maxOutputSize?: number;
  env?: Record<string, string>;
  cwd?: string;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

export interface PoolStats {
  warm: number;
  active: number;
  totalCreated: number;
  totalRecycled: number;
  avgAcquireMs: number;
}

export interface PoolConfig {
  warmPoolSize?: number;
  maxConcurrent?: number;
  idleTimeoutMs?: number;
  defaultTimeout?: number;
  defaultMaxMemory?: number;
  defaultMaxOutputSize?: number;
}

interface ManagedInstance {
  id: string;
  runtime: RuntimeType;
  tmpDir: string;
  createdAt: number;
  state: 'warm' | 'active';
}

// ────────────────────────── Constants ───────────────────────────

const DEFAULT_WARM_POOL_SIZE = 3;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_MEMORY = 512 * 1024 * 1024; // 512 MB
const DEFAULT_MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10 MB

// ────────────────────────── Pool ────────────────────────────────

export class SandboxPool {
  private readonly warmPool: Map<string, ManagedInstance> = new Map();
  private readonly activePool: Map<string, ManagedInstance> = new Map();
  private readonly credentialPassthrough: CredentialPassthrough;
  private readonly runtimeDetector: RuntimeDetector;

  private readonly warmPoolSize: number;
  private readonly maxConcurrent: number;
  private readonly idleTimeoutMs: number;
  private readonly defaultTimeout: number;
  private readonly defaultMaxMemory: number;
  private readonly defaultMaxOutputSize: number;

  private totalCreated = 0;
  private totalRecycled = 0;
  private acquireLatencySum = 0;
  private acquireCount = 0;

  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private drained = false;

  constructor(config?: PoolConfig) {
    this.warmPoolSize = config?.warmPoolSize ?? DEFAULT_WARM_POOL_SIZE;
    this.maxConcurrent = config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.idleTimeoutMs = config?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.defaultTimeout = config?.defaultTimeout ?? DEFAULT_TIMEOUT_MS;
    this.defaultMaxMemory = config?.defaultMaxMemory ?? DEFAULT_MAX_MEMORY;
    this.defaultMaxOutputSize =
      config?.defaultMaxOutputSize ?? DEFAULT_MAX_OUTPUT_SIZE;
    this.credentialPassthrough = new CredentialPassthrough();
    this.runtimeDetector = new RuntimeDetector();

    this.startIdleSweep();
  }

  // ── Acquire / Release ──────────────────────────────────────

  async acquire(runtime: RuntimeType): Promise<ManagedInstance> {
    if (this.drained) {
      throw new Error('Pool has been drained');
    }

    const start = Date.now();

    // Try to pick from warm pool
    for (const [id, inst] of this.warmPool) {
      if (inst.runtime === runtime) {
        this.warmPool.delete(id);
        inst.state = 'active';
        this.activePool.set(id, inst);
        this.recordAcquireLatency(start);
        return inst;
      }
    }

    // Check concurrency limit
    if (this.activePool.size >= this.maxConcurrent) {
      throw new Error(
        `Max concurrent sandboxes reached (${this.maxConcurrent})`,
      );
    }

    // Create new instance
    const inst = await this.createInstance(runtime);
    inst.state = 'active';
    this.activePool.set(inst.id, inst);
    this.recordAcquireLatency(start);
    return inst;
  }

  async release(instance: ManagedInstance): Promise<void> {
    this.activePool.delete(instance.id);

    // Clean temp directory
    try {
      await rm(instance.tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }

    // Return to warm pool or discard
    if (this.warmPool.size < this.warmPoolSize && !this.drained) {
      const refreshed = await this.createInstance(instance.runtime);
      refreshed.state = 'warm';
      this.warmPool.set(refreshed.id, refreshed);
      this.totalRecycled++;
    }
  }

  // ── Execute (convenience) ─────────────────────────────────

  async execute(
    code: string,
    runtime: RuntimeType,
    options?: ExecOptions,
  ): Promise<ExecutionResult> {
    const instance = await this.acquire(runtime);
    try {
      return await this.runInProcess(code, runtime, instance, options);
    } finally {
      await this.release(instance);
    }
  }

  // ── Stats ─────────────────────────────────────────────────

  getStats(): PoolStats {
    return {
      warm: this.warmPool.size,
      active: this.activePool.size,
      totalCreated: this.totalCreated,
      totalRecycled: this.totalRecycled,
      avgAcquireMs:
        this.acquireCount > 0
          ? Math.round(this.acquireLatencySum / this.acquireCount)
          : 0,
    };
  }

  // ── Drain ─────────────────────────────────────────────────

  async drain(): Promise<void> {
    this.drained = true;

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    // Clean all warm instances
    const warmCleanups = [...this.warmPool.values()].map((inst) =>
      rm(inst.tmpDir, { recursive: true, force: true }).catch(() => {}),
    );
    this.warmPool.clear();

    // Clean all active instances
    const activeCleanups = [...this.activePool.values()].map((inst) =>
      rm(inst.tmpDir, { recursive: true, force: true }).catch(() => {}),
    );
    this.activePool.clear();

    await Promise.all([...warmCleanups, ...activeCleanups]);
  }

  // ── Internals ─────────────────────────────────────────────

  private async createInstance(runtime: RuntimeType): Promise<ManagedInstance> {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), `cf-sandbox-${runtime}-`),
    );
    this.totalCreated++;

    return {
      id: randomUUID(),
      runtime,
      tmpDir,
      createdAt: Date.now(),
      state: 'warm',
    };
  }

  private async runInProcess(
    code: string,
    runtime: RuntimeType,
    instance: ManagedInstance,
    options?: ExecOptions,
  ): Promise<ExecutionResult> {
    const timeout = options?.timeout ?? this.defaultTimeout;
    const maxOutputSize = options?.maxOutputSize ?? this.defaultMaxOutputSize;
    const maxMemory = options?.maxMemory ?? this.defaultMaxMemory;
    const env = this.credentialPassthrough.getPassthroughEnv(options?.env);
    const cwd = options?.cwd ?? instance.tmpDir;

    const { cmd, args } = await this.buildCommand(
      code,
      runtime,
      instance.tmpDir,
      maxMemory,
    );

    const start = Date.now();
    return new Promise<ExecutionResult>((resolve) => {
      const child: ChildProcess = spawn(cmd, args, {
        env,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const settle = (exitCode: number) => {
        if (settled) return;
        settled = true;
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - start,
          timedOut,
          truncated,
        });
      };

      // Collect stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < maxOutputSize) {
          stdout += chunk.toString();
          if (stdout.length > maxOutputSize) {
            stdout = stdout.slice(0, maxOutputSize);
            truncated = true;
          }
        }
      });

      // Collect stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < maxOutputSize) {
          stderr += chunk.toString();
          if (stderr.length > maxOutputSize) {
            stderr = stderr.slice(0, maxOutputSize);
            truncated = true;
          }
        }
      });

      child.on('close', (exitCode) => {
        settle(exitCode ?? 1);
      });

      child.on('error', (err) => {
        stderr += err.message;
        settle(1);
      });

      // Timeout enforcement
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeout);

      child.on('close', () => clearTimeout(timer));
    });
  }

  private async buildCommand(
    code: string,
    runtime: RuntimeType,
    tmpDir: string,
    maxMemory: number,
  ): Promise<{ cmd: string; args: string[] }> {
    const maxMemoryMb = Math.floor(maxMemory / (1024 * 1024));

    switch (runtime) {
      case 'javascript': {
        const runner = this.detectBun() ? 'bun' : 'node';
        const file = path.join(tmpDir, 'script.mjs');
        await writeFile(file, code, 'utf8');
        if (runner === 'node') {
          return {
            cmd: runner,
            args: [`--max-old-space-size=${maxMemoryMb}`, file],
          };
        }
        return { cmd: runner, args: ['run', file] };
      }
      case 'typescript': {
        const file = path.join(tmpDir, 'script.ts');
        await writeFile(file, code, 'utf8');
        if (this.detectBun()) {
          return { cmd: 'bun', args: ['run', file] };
        }
        return { cmd: 'npx', args: ['tsx', file] };
      }
      case 'python':
        return { cmd: 'python3', args: ['-c', code] };
      case 'shell':
        return { cmd: 'sh', args: ['-c', code] };
      case 'ruby':
        return { cmd: 'ruby', args: ['-e', code] };
      case 'go': {
        const file = path.join(tmpDir, 'main.go');
        await writeFile(file, code, 'utf8');
        return { cmd: 'go', args: ['run', file] };
      }
      case 'rust': {
        const file = path.join(tmpDir, 'main.rs');
        await writeFile(file, code, 'utf8');
        return { cmd: 'rustc', args: [file, '-o', path.join(tmpDir, 'out')] };
      }
      case 'php':
        return { cmd: 'php', args: ['-r', code] };
      case 'perl':
        return { cmd: 'perl', args: ['-e', code] };
      case 'r':
        return { cmd: 'Rscript', args: ['-e', code] };
      case 'elixir':
        return { cmd: 'elixir', args: ['-e', code] };
      default:
        return { cmd: 'sh', args: ['-c', code] };
    }
  }

  private detectBun(): boolean {
    try {
      execFileSync('which', ['bun'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private startIdleSweep(): void {
    this.idleTimer = setInterval(() => {
      const now = Date.now();
      for (const [id, inst] of this.warmPool) {
        if (now - inst.createdAt > this.idleTimeoutMs) {
          this.warmPool.delete(id);
          rm(inst.tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    }, Math.min(this.idleTimeoutMs, 30_000));

    // Allow process to exit even if timer is active
    if (this.idleTimer) {
      this.idleTimer.unref();
    }
  }

  private recordAcquireLatency(start: number): void {
    this.acquireLatencySum += Date.now() - start;
    this.acquireCount++;
  }
}
