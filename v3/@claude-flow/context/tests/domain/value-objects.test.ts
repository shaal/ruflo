import { describe, it, expect } from 'vitest';
import { CompressionRatio } from '../../src/domain/value-objects/CompressionRatio.js';
import { ContextBudget } from '../../src/domain/value-objects/ContextBudget.js';
import { SearchQuery } from '../../src/domain/value-objects/SearchQuery.js';
import { SnippetWindow } from '../../src/domain/value-objects/SnippetWindow.js';

describe('CompressionRatio', () => {
  it('creates from raw and compressed sizes', () => {
    const ratio = CompressionRatio.create(1000, 200);
    expect(ratio.getValue()).toBeCloseTo(0.8);
    expect(ratio.getPercentage()).toBeCloseTo(80);
  });

  it('returns 0 when rawSize is 0', () => {
    const ratio = CompressionRatio.create(0, 0);
    expect(ratio.getValue()).toBe(0);
  });

  it('throws when compressedSize exceeds rawSize', () => {
    expect(() => CompressionRatio.create(100, 200)).toThrow(RangeError);
  });

  it('throws when sizes are negative', () => {
    expect(() => CompressionRatio.create(-1, 0)).toThrow(RangeError);
    expect(() => CompressionRatio.create(100, -1)).toThrow(RangeError);
  });

  it('none() returns ratio of 0', () => {
    const ratio = CompressionRatio.none();
    expect(ratio.getValue()).toBe(0);
  });

  it('maximum() returns ratio of 1', () => {
    const ratio = CompressionRatio.maximum();
    expect(ratio.getValue()).toBe(1);
  });

  it('meetsTarget checks against default 0.95', () => {
    expect(CompressionRatio.create(100, 4).meetsTarget()).toBe(true);
    expect(CompressionRatio.create(100, 5).meetsTarget()).toBe(true);
    expect(CompressionRatio.create(100, 6).meetsTarget()).toBe(false);
  });

  it('meetsTarget checks against custom target', () => {
    const ratio = CompressionRatio.create(100, 30);
    expect(ratio.meetsTarget(0.7)).toBe(true);
    expect(ratio.meetsTarget(0.8)).toBe(false);
  });

  it('equals compares by value', () => {
    const a = CompressionRatio.create(1000, 200);
    const b = CompressionRatio.create(500, 100);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(CompressionRatio.none())).toBe(false);
  });
});

describe('ContextBudget', () => {
  it('creates with zero consumption', () => {
    const budget = ContextBudget.create(10000);
    expect(budget.getTotal()).toBe(10000);
    expect(budget.getConsumed()).toBe(0);
    expect(budget.getRemaining()).toBe(10000);
    expect(budget.getUtilization()).toBe(0);
  });

  it('throws for negative totalTokens', () => {
    expect(() => ContextBudget.create(-1)).toThrow(RangeError);
  });

  it('consume returns a new instance', () => {
    const a = ContextBudget.create(1000);
    const b = a.consume(300);
    expect(a.getConsumed()).toBe(0);
    expect(b.getConsumed()).toBe(300);
    expect(b.getRemaining()).toBe(700);
  });

  it('consume throws when exceeding budget', () => {
    const budget = ContextBudget.create(100);
    expect(() => budget.consume(101)).toThrow(RangeError);
  });

  it('consume throws for negative tokens', () => {
    const budget = ContextBudget.create(100);
    expect(() => budget.consume(-1)).toThrow(RangeError);
  });

  it('canConsume checks without throwing', () => {
    const budget = ContextBudget.create(100);
    expect(budget.canConsume(100)).toBe(true);
    expect(budget.canConsume(101)).toBe(false);
    expect(budget.canConsume(-1)).toBe(false);
  });

  describe('getThrottleLevel', () => {
    it('returns NORMAL below 50%', () => {
      const budget = ContextBudget.create(1000).consume(499);
      expect(budget.getThrottleLevel()).toBe('NORMAL');
    });

    it('returns REDUCED at 50-74%', () => {
      const budget = ContextBudget.create(1000).consume(500);
      expect(budget.getThrottleLevel()).toBe('REDUCED');
      expect(ContextBudget.create(1000).consume(749).getThrottleLevel()).toBe('REDUCED');
    });

    it('returns MINIMAL at 75-89%', () => {
      const budget = ContextBudget.create(1000).consume(750);
      expect(budget.getThrottleLevel()).toBe('MINIMAL');
      expect(ContextBudget.create(1000).consume(899).getThrottleLevel()).toBe('MINIMAL');
    });

    it('returns BLOCKED at 90%+', () => {
      const budget = ContextBudget.create(1000).consume(900);
      expect(budget.getThrottleLevel()).toBe('BLOCKED');
      expect(ContextBudget.create(1000).consume(1000).getThrottleLevel()).toBe('BLOCKED');
    });

    it('returns NORMAL for zero-total budget', () => {
      const budget = ContextBudget.create(0);
      expect(budget.getThrottleLevel()).toBe('NORMAL');
    });
  });

  it('getUtilization returns 0 for zero-total', () => {
    expect(ContextBudget.create(0).getUtilization()).toBe(0);
  });

  it('equals compares both fields', () => {
    const a = ContextBudget.create(1000).consume(500);
    const b = ContextBudget.create(1000).consume(500);
    const c = ContextBudget.create(1000).consume(501);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe('SearchQuery', () => {
  it('normalizes to lowercase and trims', () => {
    const q = SearchQuery.create('  Hello WORLD  ');
    expect(q.getRaw()).toBe('  Hello WORLD  ');
    expect(q.getNormalized()).toBe('hello world');
  });

  it('tokenizes on whitespace', () => {
    const q = SearchQuery.create('foo bar  baz');
    expect(q.getTokens()).toEqual(['foo', 'bar', 'baz']);
    expect(q.getTokenCount()).toBe(3);
  });

  it('throws on empty query', () => {
    expect(() => SearchQuery.create('')).toThrow();
    expect(() => SearchQuery.create('   ')).toThrow();
  });

  it('toFTS5Match joins tokens with AND', () => {
    const q = SearchQuery.create('hello world');
    expect(q.toFTS5Match()).toBe('hello AND world');
  });

  it('toTrigramPattern returns normalized query', () => {
    const q = SearchQuery.create('Hello');
    expect(q.toTrigramPattern()).toBe('hello');
  });

  it('handles single-token queries', () => {
    const q = SearchQuery.create('search');
    expect(q.getTokenCount()).toBe(1);
    expect(q.toFTS5Match()).toBe('search');
  });

  it('tokens array is frozen', () => {
    const q = SearchQuery.create('a b c');
    expect(Object.isFrozen(q.getTokens())).toBe(true);
  });
});

describe('SnippetWindow', () => {
  const baseProps = {
    text: 'This is some sample text for testing.',
    heading: 'Test Section',
    matchLayer: 'stemming' as const,
    relevanceScore: 0.85,
    highlightRanges: [{ start: 0, end: 4 }, { start: 13, end: 19 }],
  };

  it('creates with valid props', () => {
    const snippet = SnippetWindow.create(baseProps);
    expect(snippet.text).toBe(baseProps.text);
    expect(snippet.heading).toBe('Test Section');
    expect(snippet.matchLayer).toBe('stemming');
    expect(snippet.relevanceScore).toBe(0.85);
  });

  it('freezes highlightRanges', () => {
    const snippet = SnippetWindow.create(baseProps);
    expect(Object.isFrozen(snippet.highlightRanges)).toBe(true);
  });

  it('throws for relevanceScore out of range', () => {
    expect(() => SnippetWindow.create({ ...baseProps, relevanceScore: -0.1 })).toThrow(RangeError);
    expect(() => SnippetWindow.create({ ...baseProps, relevanceScore: 1.1 })).toThrow(RangeError);
  });

  it('allows boundary relevanceScores', () => {
    expect(() => SnippetWindow.create({ ...baseProps, relevanceScore: 0 })).not.toThrow();
    expect(() => SnippetWindow.create({ ...baseProps, relevanceScore: 1 })).not.toThrow();
  });

  it('getTokenEstimate returns ceil(length / 4)', () => {
    const snippet = SnippetWindow.create(baseProps);
    expect(snippet.getTokenEstimate()).toBe(Math.ceil(baseProps.text.length / 4));
  });

  it('getTokenEstimate returns 0 for empty text', () => {
    const snippet = SnippetWindow.create({ ...baseProps, text: '' });
    expect(snippet.getTokenEstimate()).toBe(0);
  });

  it('supports all match layers', () => {
    for (const layer of ['stemming', 'trigram', 'fuzzy'] as const) {
      const s = SnippetWindow.create({ ...baseProps, matchLayer: layer });
      expect(s.matchLayer).toBe(layer);
    }
  });
});
