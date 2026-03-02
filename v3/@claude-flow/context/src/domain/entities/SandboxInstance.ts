/**
 * SandboxInstance — Entity with lifecycle state machine.
 *
 * Identity: sandboxId.
 * Lifecycle: IDLE → ACQUIRED → EXECUTING → TERMINATED
 */
import { randomUUID } from 'crypto';

export enum SandboxState {
  IDLE = 'IDLE',
  ACQUIRED = 'ACQUIRED',
  EXECUTING = 'EXECUTING',
  TERMINATED = 'TERMINATED',
}

/** Re-export canonical RuntimeType from the sandbox layer. */
export type { RuntimeType } from '../../sandbox/RuntimeDetector.js';
import type { RuntimeType } from '../../sandbox/RuntimeDetector.js';

export class SandboxInstance {
  readonly sandboxId: string;
  readonly runtime: RuntimeType;
  readonly pid: number | null;
  readonly createdAt: Date;
  private _state: SandboxState;
  private _lastUsedAt: Date;

  constructor(params: {
    runtime: RuntimeType;
    pid?: number | null;
    sandboxId?: string;
    createdAt?: Date;
  }) {
    this.sandboxId = params.sandboxId ?? randomUUID();
    this.runtime = params.runtime;
    this.pid = params.pid ?? null;
    this.createdAt = params.createdAt ?? new Date();
    this._state = SandboxState.IDLE;
    this._lastUsedAt = this.createdAt;
  }

  getState(): SandboxState {
    return this._state;
  }

  getLastUsedAt(): Date {
    return this._lastUsedAt;
  }

  acquire(): void {
    if (this._state !== SandboxState.IDLE) {
      throw new Error(
        `Cannot acquire sandbox in state ${this._state}; must be IDLE`,
      );
    }
    this._state = SandboxState.ACQUIRED;
    this._lastUsedAt = new Date();
  }

  markExecuting(): void {
    if (this._state !== SandboxState.ACQUIRED) {
      throw new Error(
        `Cannot mark executing in state ${this._state}; must be ACQUIRED`,
      );
    }
    this._state = SandboxState.EXECUTING;
    this._lastUsedAt = new Date();
  }

  release(): void {
    if (
      this._state !== SandboxState.ACQUIRED &&
      this._state !== SandboxState.EXECUTING
    ) {
      throw new Error(
        `Cannot release sandbox in state ${this._state}; must be ACQUIRED or EXECUTING`,
      );
    }
    this._state = SandboxState.IDLE;
    this._lastUsedAt = new Date();
  }

  terminate(): void {
    this._state = SandboxState.TERMINATED;
    this._lastUsedAt = new Date();
  }

  /** Whether the sandbox has been idle longer than the given timeout. */
  isStale(idleTimeoutMs: number): boolean {
    if (this._state !== SandboxState.IDLE) return false;
    return Date.now() - this._lastUsedAt.getTime() > idleTimeoutMs;
  }
}
