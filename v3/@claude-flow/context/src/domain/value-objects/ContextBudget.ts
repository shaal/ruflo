/**
 * ContextBudget — Immutable token budget with throttle-level awareness.
 *
 * Tracks total and consumed tokens for an agent or session.
 * Returns new instances on mutation (immutable value object).
 */

export type ThrottleLevel = 'NORMAL' | 'REDUCED' | 'MINIMAL' | 'BLOCKED';

export class ContextBudget {
  private constructor(
    private readonly totalTokens: number,
    private readonly consumedTokens: number,
  ) {
    if (totalTokens < 0) {
      throw new RangeError('totalTokens must be non-negative');
    }
    if (consumedTokens < 0) {
      throw new RangeError('consumedTokens must be non-negative');
    }
    if (consumedTokens > totalTokens) {
      throw new RangeError('consumedTokens cannot exceed totalTokens');
    }
  }

  /** Create a fresh budget with zero consumption. */
  static create(total: number): ContextBudget {
    return new ContextBudget(total, 0);
  }

  /** Return a new budget with the given tokens consumed. */
  consume(tokens: number): ContextBudget {
    if (tokens < 0) {
      throw new RangeError('tokens to consume must be non-negative');
    }
    const next = this.consumedTokens + tokens;
    if (next > this.totalTokens) {
      throw new RangeError(
        `Cannot consume ${tokens} tokens: would exceed budget (${this.getRemaining()} remaining)`,
      );
    }
    return new ContextBudget(this.totalTokens, next);
  }

  /** Tokens still available. */
  getRemaining(): number {
    return this.totalTokens - this.consumedTokens;
  }

  /** Fraction consumed in [0, 1]. */
  getUtilization(): number {
    if (this.totalTokens === 0) return 0;
    return this.consumedTokens / this.totalTokens;
  }

  /**
   * Throttle level based on utilization thresholds:
   *  - < 50% → NORMAL
   *  - < 75% → REDUCED
   *  - < 90% → MINIMAL
   *  - ≥ 90% → BLOCKED
   */
  getThrottleLevel(): ThrottleLevel {
    const util = this.getUtilization();
    if (util < 0.5) return 'NORMAL';
    if (util < 0.75) return 'REDUCED';
    if (util < 0.9) return 'MINIMAL';
    return 'BLOCKED';
  }

  /** Whether the budget can accommodate the given tokens. */
  canConsume(tokens: number): boolean {
    return tokens >= 0 && this.consumedTokens + tokens <= this.totalTokens;
  }

  /** Total allocated tokens. */
  getTotal(): number {
    return this.totalTokens;
  }

  /** Tokens consumed so far. */
  getConsumed(): number {
    return this.consumedTokens;
  }

  equals(other: ContextBudget): boolean {
    return (
      this.totalTokens === other.totalTokens &&
      this.consumedTokens === other.consumedTokens
    );
  }
}
