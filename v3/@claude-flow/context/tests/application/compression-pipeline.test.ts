/**
 * CompressionPipelineService tests — London School TDD with mocked deps.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CompressionPipelineService,
  type IChunkingEngine,
  type IKnowledgeBase,
  type ICompressionSession,
  type RawToolOutput,
} from '../../src/application/CompressionPipelineService.js';

// ─── Helpers ────────────────────────────────────────────────────────

function makeOutput(size: number, content?: string): RawToolOutput {
  const text = content ?? 'x'.repeat(size);
  return {
    content: text,
    toolName: 'Read',
    sizeBytes: size,
    agentId: 'agent-1',
  };
}

function createMocks() {
  const chunkingEngine: IChunkingEngine = {
    chunk: vi.fn().mockReturnValue([]),
  };
  const knowledgeBase: IKnowledgeBase = {
    addChunk: vi.fn().mockReturnValue(true),
  };
  const compressionSession: ICompressionSession = {
    recordCompression: vi.fn(),
  };
  return { chunkingEngine, knowledgeBase, compressionSession };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('CompressionPipelineService', () => {
  let mocks: ReturnType<typeof createMocks>;
  let pipeline: CompressionPipelineService;

  beforeEach(() => {
    mocks = createMocks();
    pipeline = new CompressionPipelineService(
      mocks.chunkingEngine,
      mocks.knowledgeBase,
      mocks.compressionSession,
      'test-session',
    );
  });

  describe('passthrough for small outputs', () => {
    it('should pass through outputs below bypassThreshold unchanged', async () => {
      const output = makeOutput(500, 'small output');

      const result = await pipeline.compress(output);

      expect(result.passedThrough).toBe(true);
      expect(result.content).toBe('small output');
      expect(result.originalSizeBytes).toBe(500);
      expect(result.ratio.getValue()).toBe(0);
    });

    it('should not index small outputs in knowledge base', async () => {
      const output = makeOutput(500);

      await pipeline.compress(output);

      expect(mocks.knowledgeBase.addChunk).not.toHaveBeenCalled();
    });

    it('should record stats even for passthrough', async () => {
      const output = makeOutput(500);

      await pipeline.compress(output);

      expect(mocks.compressionSession.recordCompression).toHaveBeenCalledWith(
        'Read',
        500,
        500,
      );
    });
  });

  describe('medium output path (1-5KB)', () => {
    it('should compress medium outputs via snippet extraction', async () => {
      const content = '# Title\n\nSome paragraph\n\n' + 'text '.repeat(500);
      const output = makeOutput(2500, content);

      const result = await pipeline.compress(output, { maxTokens: 50 });

      expect(result.passedThrough).toBe(false);
      expect(result.sizeBytes).toBeLessThan(result.originalSizeBytes);
    });

    it('should index medium outputs in knowledge base', async () => {
      const content = 'Some medium sized content here.';
      const output = makeOutput(1500, content);

      (mocks.chunkingEngine.chunk as ReturnType<typeof vi.fn>).mockReturnValue([
        { text: content, heading: '', index: 0, tokenEstimate: 10, hasCodeBlock: false },
      ]);

      await pipeline.compress(output);

      expect(mocks.knowledgeBase.addChunk).toHaveBeenCalled();
    });
  });

  describe('large output full pipeline (>5KB)', () => {
    it('should apply full pipeline with intent filtering', async () => {
      const content =
        '# Auth Module\n\nAuthentication logic.\n\n' +
        '# Logging Module\n\nLogging setup.\n\n' +
        'x'.repeat(5000);
      const output = makeOutput(6000, content);

      (mocks.chunkingEngine.chunk as ReturnType<typeof vi.fn>).mockReturnValue([
        {
          text: 'Authentication logic.',
          heading: 'Auth Module',
          index: 0,
          tokenEstimate: 10,
          hasCodeBlock: false,
        },
        {
          text: 'Logging setup.',
          heading: 'Logging Module',
          index: 1,
          tokenEstimate: 10,
          hasCodeBlock: false,
        },
      ]);

      const result = await pipeline.compress(output, {
        intent: 'auth',
        maxTokens: 100,
        intentThreshold: 5000,
      });

      expect(result.passedThrough).toBe(false);
      expect(result.content).toContain('Auth');
    });

    it('should handle large output without intent', async () => {
      const content = 'x'.repeat(6000);
      const output = makeOutput(6000, content);

      const result = await pipeline.compress(output, { maxTokens: 100 });

      expect(result.passedThrough).toBe(false);
    });
  });

  describe('stats tracking', () => {
    it('should track cumulative stats', async () => {
      await pipeline.compress(makeOutput(500));
      await pipeline.compress(makeOutput(800));

      const stats = pipeline.getStats();
      expect(stats.totalCompressions).toBe(2);
      expect(stats.totalRawBytes).toBe(1300);
    });

    it('should reset stats', async () => {
      await pipeline.compress(makeOutput(500));
      pipeline.reset();

      const stats = pipeline.getStats();
      expect(stats.totalCompressions).toBe(0);
      expect(stats.totalRawBytes).toBe(0);
    });
  });

  describe('custom bypass threshold', () => {
    it('should respect custom bypassThreshold', async () => {
      const output = makeOutput(500);

      const result = await pipeline.compress(output, {
        bypassThreshold: 200,
      });

      expect(result.passedThrough).toBe(false);
    });
  });
});
