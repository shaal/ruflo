/**
 * ChunkingEngine Tests
 *
 * Validates heading-aware splitting, code block preservation,
 * size enforcement, and overlap application.
 */
import { describe, it, expect } from 'vitest';
import { ChunkingEngine } from '../../src/infrastructure/ChunkingEngine.js';

describe('ChunkingEngine', () => {
  const engine = new ChunkingEngine();

  describe('basic splitting by headings', () => {
    it('should split markdown content into heading-bounded chunks', () => {
      const content = [
        '# Introduction',
        'This is the intro paragraph.',
        '',
        '## Getting Started',
        'Follow these steps to get started.',
        '',
        '## Advanced Usage',
        'For advanced users, consider the following.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });

      expect(chunks.length).toBe(3);
      expect(chunks[0].heading).toBe('Introduction');
      expect(chunks[0].text).toContain('intro paragraph');
      expect(chunks[1].heading).toBe('Getting Started');
      expect(chunks[1].text).toContain('get started');
      expect(chunks[2].heading).toBe('Advanced Usage');
      expect(chunks[2].text).toContain('advanced users');
    });

    it('should handle ### level headings', () => {
      const content = [
        '# Top',
        'Top content.',
        '### Sub-subsection',
        'Deep content.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.length).toBe(2);
      expect(chunks[1].heading).toBe('Sub-subsection');
    });

    it('should handle HTML headings', () => {
      const content = [
        '<h1>Title</h1>',
        'Some intro text.',
        '<h2>Section One</h2>',
        'Section one content.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.length).toBe(2);
      expect(chunks[0].heading).toBe('Title');
      expect(chunks[1].heading).toBe('Section One');
    });
  });

  describe('code block preservation', () => {
    it('should never split within a fenced code block', () => {
      const content = [
        '# Setup',
        'Install the dependencies:',
        '```bash',
        'npm install express',
        'npm install typescript',
        'npm install vitest',
        '```',
        '',
        '# Configuration',
        'Configure your project.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });

      // The code block should be entirely in the first chunk
      expect(chunks.length).toBe(2);
      expect(chunks[0].text).toContain('npm install express');
      expect(chunks[0].text).toContain('npm install vitest');
      expect(chunks[0].hasCodeBlock).toBe(true);
      expect(chunks[1].heading).toBe('Configuration');
    });

    it('should mark chunks with code blocks', () => {
      const content = [
        '# Example',
        '```typescript',
        'const x = 1;',
        '```',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks[0].hasCodeBlock).toBe(true);
    });

    it('should not treat heading-like lines inside code blocks as headings', () => {
      const content = [
        '# Real Heading',
        'Some text.',
        '```markdown',
        '# This is not a heading',
        '## Neither is this',
        '```',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].heading).toBe('Real Heading');
      expect(chunks[0].text).toContain('# This is not a heading');
    });
  });

  describe('oversized chunk splitting', () => {
    it('should split at paragraph boundaries when chunk exceeds maxChunkSize', () => {
      // Create content larger than 64 tokens (256 chars / 4 = 64 tokens)
      const para1 = 'First paragraph. '.repeat(20).trim(); // ~340 chars = ~85 tokens
      const para2 = 'Second paragraph. '.repeat(20).trim();

      const content = [
        '# Large Section',
        para1,
        '',
        para2,
      ].join('\n');

      // Use small maxChunkSize to force splitting
      const chunks = engine.chunk(content, {
        maxChunkSize: 128,
        overlapTokens: 0,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // Each chunk should be under the limit (approximately)
      for (const chunk of chunks) {
        // Allow some tolerance for heading line
        expect(chunk.tokenEstimate).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('overlap', () => {
    it('should apply overlap tokens between consecutive chunks', () => {
      const content = [
        '# Part One',
        'Content of part one with some meaningful text.',
        '',
        '# Part Two',
        'Content of part two continues the story.',
      ].join('\n');

      const chunksWithOverlap = engine.chunk(content, { overlapTokens: 16 });
      const chunksWithout = engine.chunk(content, { overlapTokens: 0 });

      // Second chunk with overlap should be longer than without
      expect(chunksWithOverlap.length).toBe(2);
      expect(chunksWithout.length).toBe(2);

      // The overlapped chunk should contain some text from the previous chunk
      expect(chunksWithOverlap[1].text.length).toBeGreaterThan(
        chunksWithout[1].text.length,
      );
    });

    it('should not apply overlap to the first chunk', () => {
      const content = [
        '# First',
        'First content.',
        '# Second',
        'Second content.',
      ].join('\n');

      const chunksA = engine.chunk(content, { overlapTokens: 32 });
      const chunksB = engine.chunk(content, { overlapTokens: 0 });

      // First chunks should be identical
      expect(chunksA[0].text).toBe(chunksB[0].text);
    });
  });

  describe('content with no headings', () => {
    it('should return a single chunk for headingless content', () => {
      const content = 'Just a plain paragraph without any headings at all.';

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].heading).toBe('');
      expect(chunks[0].text).toBe(content);
    });
  });

  describe('empty content', () => {
    it('should return empty array for empty string', () => {
      expect(engine.chunk('')).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(engine.chunk('   \n\n  ')).toEqual([]);
    });
  });

  describe('chunk metadata', () => {
    it('should assign sequential indices', () => {
      const content = [
        '# A',
        'Content A.',
        '# B',
        'Content B.',
        '# C',
        'Content C.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    });

    it('should estimate tokens as ceil(length / 4)', () => {
      const content = '# Test\n' + 'x'.repeat(100);
      const chunks = engine.chunk(content, { overlapTokens: 0 });

      const expectedLen = ('# Test\n' + 'x'.repeat(100)).length;
      expect(chunks[0].tokenEstimate).toBe(Math.ceil(expectedLen / 4));
    });
  });

  describe('edge cases', () => {
    it('should handle content with only a heading', () => {
      const chunks = engine.chunk('# Just a heading', { overlapTokens: 0 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].heading).toBe('Just a heading');
    });

    it('should handle unclosed code blocks', () => {
      const content = [
        '# Section',
        '```typescript',
        'const x = 1;',
        // No closing fence
      ].join('\n');

      // Should not throw — treats remaining lines as part of the code block
      const chunks = engine.chunk(content, { overlapTokens: 0 });
      expect(chunks.length).toBe(1);
      expect(chunks[0].hasCodeBlock).toBe(true);
    });

    it('should handle consecutive headings with no body', () => {
      const content = [
        '# Heading 1',
        '# Heading 2',
        '# Heading 3',
        'Final content.',
      ].join('\n');

      const chunks = engine.chunk(content, { overlapTokens: 0 });
      // Each heading starts a new chunk
      expect(chunks.length).toBe(3);
    });
  });
});
