/**
 * LevenshteinCorrector — Layer 3 fuzzy search via edit distance.
 *
 * Computes Levenshtein distance between strings and finds the closest
 * matching term from a vocabulary set, with early-exit optimizations.
 *
 * Optimizations:
 * - Early exit when length difference > maxDistance
 * - Single-row DP (space O(min(n, m)))
 * - Vocabulary scan limited to terms within ±maxDistance chars of query length
 *
 * @see ADR-059a §4.3
 */

export class LevenshteinCorrector {
  /**
   * Find the closest vocabulary term within maxDistance edits.
   * Returns null if no match is found within the threshold.
   *
   * @param query - The (potentially misspelled) input term
   * @param vocabulary - List of known-good terms to match against
   * @param maxDistance - Maximum allowed edit distance (default: 2)
   */
  correct(
    query: string,
    vocabulary: string[],
    maxDistance: number = 2,
  ): string | null {
    if (!query || vocabulary.length === 0) {
      return null;
    }

    const queryLower = query.toLowerCase();
    const queryLen = queryLower.length;

    let bestTerm: string | null = null;
    let bestDist = maxDistance + 1;

    for (const term of vocabulary) {
      // Early exit: length difference alone exceeds maxDistance
      if (Math.abs(term.length - queryLen) > maxDistance) {
        continue;
      }

      const dist = this.distance(queryLower, term.toLowerCase());

      if (dist < bestDist) {
        bestDist = dist;
        bestTerm = term;

        // Perfect match shortcut
        if (dist === 0) return term;
      }
    }

    return bestDist <= maxDistance ? bestTerm : null;
  }

  /**
   * Compute the Levenshtein edit distance between two strings.
   * Uses single-row DP for O(min(n, m)) space.
   */
  distance(a: string, b: string): number {
    // Ensure a is the shorter string for space optimization
    if (a.length > b.length) {
      [a, b] = [b, a];
    }

    const m = a.length;
    const n = b.length;

    // Trivial cases
    if (m === 0) return n;
    if (n === 0) return m;

    // Single-row DP: only need previous row
    const row = new Array<number>(m + 1);
    for (let i = 0; i <= m; i++) {
      row[i] = i;
    }

    for (let j = 1; j <= n; j++) {
      let prev = row[0];
      row[0] = j;

      for (let i = 1; i <= m; i++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const temp = row[i];
        row[i] = Math.min(
          row[i] + 1,      // deletion
          row[i - 1] + 1,  // insertion
          prev + cost,      // substitution
        );
        prev = temp;
      }
    }

    return row[m];
  }
}
