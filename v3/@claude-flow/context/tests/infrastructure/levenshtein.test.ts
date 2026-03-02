/**
 * LevenshteinCorrector Tests
 *
 * Validates edit distance computation and closest-match correction
 * with early-exit optimizations.
 */
import { describe, it, expect } from 'vitest';
import { LevenshteinCorrector } from '../../src/infrastructure/LevenshteinCorrector.js';

describe('LevenshteinCorrector', () => {
  const corrector = new LevenshteinCorrector();

  describe('distance()', () => {
    it('should compute distance for classic example: kitten → sitting = 3', () => {
      expect(corrector.distance('kitten', 'sitting')).toBe(3);
    });

    it('should return 0 for identical strings', () => {
      expect(corrector.distance('hello', 'hello')).toBe(0);
    });

    it('should return length of other string when one is empty', () => {
      expect(corrector.distance('', 'abc')).toBe(3);
      expect(corrector.distance('xyz', '')).toBe(3);
    });

    it('should return 0 for two empty strings', () => {
      expect(corrector.distance('', '')).toBe(0);
    });

    it('should handle single character differences', () => {
      expect(corrector.distance('cat', 'bat')).toBe(1);  // substitution
      expect(corrector.distance('cat', 'cats')).toBe(1);  // insertion
      expect(corrector.distance('cats', 'cat')).toBe(1);  // deletion
    });

    it('should be symmetric', () => {
      expect(corrector.distance('abc', 'def')).toBe(
        corrector.distance('def', 'abc'),
      );
      expect(corrector.distance('sunday', 'saturday')).toBe(
        corrector.distance('saturday', 'sunday'),
      );
    });

    it('should handle complete replacement', () => {
      expect(corrector.distance('abc', 'xyz')).toBe(3);
    });

    it('should compute distance for longer strings', () => {
      // sunday → saturday = 3 (s->s, u->a, n->t, d->u, a->r, y->d, +a, +y)
      // Actually: sunday → saturday = 3
      expect(corrector.distance('sunday', 'saturday')).toBe(3);
    });
  });

  describe('correct()', () => {
    const vocabulary = [
      'kubernetes',
      'authentication',
      'authorization',
      'typescript',
      'javascript',
      'useEffect',
      'useState',
      'configuration',
      'deployment',
      'infrastructure',
    ];

    it('should find "kubernetes" for "kuberntes"', () => {
      const result = corrector.correct('kuberntes', vocabulary);
      expect(result).toBe('kubernetes');
    });

    it('should find "authentication" for "authentcation"', () => {
      const result = corrector.correct('authentcation', vocabulary);
      expect(result).toBe('authentication');
    });

    it('should find "typescript" for "typescipt"', () => {
      const result = corrector.correct('typescipt', vocabulary);
      expect(result).toBe('typescript');
    });

    it('should find exact matches with distance 0', () => {
      const result = corrector.correct('kubernetes', vocabulary);
      expect(result).toBe('kubernetes');
    });

    it('should return null when no match within maxDistance', () => {
      const result = corrector.correct('xylophone', vocabulary, 2);
      expect(result).toBeNull();
    });

    it('should return null for empty query', () => {
      expect(corrector.correct('', vocabulary)).toBeNull();
    });

    it('should return null for empty vocabulary', () => {
      expect(corrector.correct('test', [])).toBeNull();
    });

    it('should respect maxDistance parameter', () => {
      // "deploment" is distance 1 from "deployment" (missing 'y')
      expect(corrector.correct('deploment', vocabulary, 1)).toBe('deployment');

      // "deplment" is distance 2 from "deployment"
      expect(corrector.correct('deplment', vocabulary, 1)).toBeNull();
      expect(corrector.correct('deplment', vocabulary, 2)).toBe('deployment');
    });

    it('should be case-insensitive', () => {
      const result = corrector.correct('KUBERNETES', vocabulary);
      expect(result).toBe('kubernetes');
    });

    it('should choose the closest match when multiple candidates exist', () => {
      // "authorizaton" is distance 1 from "authorization", distance 3+ from "authentication"
      const result = corrector.correct('authorizaton', vocabulary);
      expect(result).toBe('authorization');
    });

    it('should skip terms where length difference > maxDistance (early exit)', () => {
      // "a" has length 1; "kubernetes" has length 10; difference = 9 > maxDistance=2
      // This also tests that the function returns null quickly
      const result = corrector.correct('a', vocabulary, 2);
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle single-character vocabulary terms', () => {
      const vocab = ['a', 'b', 'c'];
      expect(corrector.correct('a', vocab)).toBe('a');
      expect(corrector.correct('d', vocab, 1)).not.toBeNull();
    });

    it('should handle very long strings', () => {
      const long1 = 'a'.repeat(100);
      const long2 = 'a'.repeat(99) + 'b';
      expect(corrector.distance(long1, long2)).toBe(1);
    });

    it('should handle unicode characters', () => {
      expect(corrector.distance('cafe', 'café')).toBe(1);
    });
  });
});
