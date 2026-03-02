/**
 * CompressionRatio — Immutable value object representing a compression ratio
 * in the range [0, 1] where 0 means no compression and 1 means maximum.
 *
 * The ratio is computed as 1 - (compressedSize / rawSize).
 */
export class CompressionRatio {
  private constructor(private readonly value: number) {
    if (value < 0 || value > 1) {
      throw new RangeError(`CompressionRatio must be in [0, 1], got ${value}`);
    }
  }

  /**
   * Create a ratio from raw and compressed sizes.
   * When rawSize is 0, returns a ratio of 0 (no compression).
   */
  static create(rawSize: number, compressedSize: number): CompressionRatio {
    if (rawSize < 0 || compressedSize < 0) {
      throw new RangeError('Sizes must be non-negative');
    }
    if (compressedSize > rawSize) {
      throw new RangeError('compressedSize cannot exceed rawSize');
    }
    if (rawSize === 0) {
      return new CompressionRatio(0);
    }
    return new CompressionRatio(1 - compressedSize / rawSize);
  }

  /** No compression applied (ratio = 0). */
  static none(): CompressionRatio {
    return new CompressionRatio(0);
  }

  /** Maximum compression (ratio = 1). */
  static maximum(): CompressionRatio {
    return new CompressionRatio(1);
  }

  /** Raw ratio value in [0, 1]. */
  getValue(): number {
    return this.value;
  }

  /** Ratio as a percentage (0–100). */
  getPercentage(): number {
    return this.value * 100;
  }

  /** Whether this ratio meets or exceeds the given target (default 0.95). */
  meetsTarget(target: number = 0.95): boolean {
    return this.value >= target;
  }

  equals(other: CompressionRatio): boolean {
    return this.value === other.value;
  }
}
