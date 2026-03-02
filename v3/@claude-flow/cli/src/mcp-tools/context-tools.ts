/**
 * Context Optimization MCP Tools for CLI
 *
 * Tool definitions for context compression, FTS5 search, budget management,
 * and diagnostics. Implements ADR-059: Context Optimization Engine.
 *
 * All tools share a lazy singleton service bundle to avoid duplicate
 * FTS5 databases or compression sessions.
 */

import type { MCPTool } from './types.js';

// ─── Lazy Singleton Service Bundle ─────────────────────────────────

interface ContextServiceBundle {
  compressionPipeline: import('@claude-flow/context').CompressionPipelineService;
  searchService: import('@claude-flow/context').UnifiedSearchService;
  budgetManager: import('@claude-flow/context').ContextBudgetManager;
  metricsCollector: import('@claude-flow/context').MetricsCollector;
  fts5Repo: import('@claude-flow/context').FTS5Repository;
  sandboxPool: import('@claude-flow/context').SandboxPool;
  compressionSession: import('@claude-flow/context').CompressionSession;
}

let bundlePromise: Promise<ContextServiceBundle | null> | null = null;

async function getContextServices(): Promise<ContextServiceBundle | null> {
  if (!bundlePromise) {
    bundlePromise = (async () => {
      try {
        const ctx = await import('@claude-flow/context');

        // Infrastructure
        const fts5Repo = new ctx.FTS5Repository();
        await fts5Repo.init();

        const chunkingEngine = new ctx.ChunkingEngine();
        const levenshteinCorrector = new ctx.LevenshteinCorrector();

        // Search stack
        const fuzzySearch = new ctx.FuzzySearchService(fts5Repo, levenshteinCorrector);
        const searchService = new ctx.UnifiedSearchService(fuzzySearch);

        // Compression stack
        const knowledgeBase = new ctx.KnowledgeBase();
        const compressionSession = new ctx.CompressionSession();
        const compressionPipeline = new ctx.CompressionPipelineService(
          chunkingEngine,
          knowledgeBase,
          compressionSession,
          knowledgeBase.sessionId,
        );

        // Budget & metrics
        const budgetManager = new ctx.ContextBudgetManager();
        const metricsCollector = new ctx.MetricsCollector();

        // Sandbox pool
        const sandboxPool = new ctx.SandboxPool();

        return {
          compressionPipeline,
          searchService,
          budgetManager,
          metricsCollector,
          fts5Repo,
          sandboxPool,
          compressionSession,
        };
      } catch {
        return null;
      }
    })();
  }
  return bundlePromise;
}

// ─── Tool Definitions ──────────────────────────────────────────────

export const contextTools: MCPTool[] = [
  {
    name: 'context_stats',
    description: 'Get context compression statistics for the current session',
    category: 'context',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const bundle = await getContextServices();
      if (!bundle) {
        return {
          success: false,
          error: '@claude-flow/context not installed. Install with: npm install @claude-flow/context',
        };
      }

      try {
        const { contextStats } = await import('@claude-flow/context');
        const stats = bundle.compressionSession.getStats();
        const formatted = await contextStats(stats);
        return { success: true, output: formatted };
      } catch (err) {
        return {
          success: false,
          error: `Failed to get context stats: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },

  {
    name: 'context_search',
    description: 'Search the context knowledge base using fuzzy FTS5 search',
    category: 'context',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return',
          default: 10,
        },
      },
      required: ['query'],
    },
    handler: async (input) => {
      const bundle = await getContextServices();
      if (!bundle) {
        return {
          success: false,
          error: '@claude-flow/context not installed. Install with: npm install @claude-flow/context',
        };
      }

      try {
        const { contextSearch } = await import('@claude-flow/context');
        const query = input.query as string;
        const formatted = await contextSearch(bundle.searchService, [query]);
        return { success: true, output: formatted };
      } catch (err) {
        return {
          success: false,
          error: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },

  {
    name: 'context_doctor',
    description: 'Run diagnostics on the context optimization engine',
    category: 'context',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const bundle = await getContextServices();
      if (!bundle) {
        return {
          success: false,
          error: '@claude-flow/context not installed. Install with: npm install @claude-flow/context',
        };
      }

      try {
        const { contextDoctor } = await import('@claude-flow/context');
        const formatted = await contextDoctor({
          fts5Repo: bundle.fts5Repo,
          sandboxPool: bundle.sandboxPool,
        });
        return { success: true, output: formatted };
      } catch (err) {
        return {
          success: false,
          error: `Doctor check failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },

  {
    name: 'context_budget',
    description: 'Get context budget allocation and usage across agents',
    category: 'context',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const bundle = await getContextServices();
      if (!bundle) {
        return {
          success: false,
          error: '@claude-flow/context not installed. Install with: npm install @claude-flow/context',
        };
      }

      try {
        const snapshot = bundle.budgetManager.getSnapshot();
        return {
          success: true,
          budget: snapshot,
        };
      } catch (err) {
        return {
          success: false,
          error: `Budget query failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },

  {
    name: 'context_compress',
    description: 'Compress content through the context optimization pipeline',
    category: 'context',
    inputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content to compress',
        },
        file: {
          type: 'string',
          description: 'File path to read and compress (alternative to content)',
        },
        intent: {
          type: 'string',
          description: 'Intent for guided compression (keeps relevant sections)',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens in compressed output',
          default: 500,
        },
      },
    },
    handler: async (input) => {
      const bundle = await getContextServices();
      if (!bundle) {
        return {
          success: false,
          error: '@claude-flow/context not installed. Install with: npm install @claude-flow/context',
        };
      }

      try {
        let content = input.content as string | undefined;

        // If file specified, read it
        if (!content && input.file) {
          const { readFileSync } = await import('fs');
          content = readFileSync(input.file as string, 'utf-8');
        }

        if (!content) {
          return {
            success: false,
            error: 'Either content or file must be provided',
          };
        }

        const result = await bundle.compressionPipeline.compress(
          {
            content,
            toolName: 'context_compress',
            sizeBytes: Buffer.byteLength(content, 'utf-8'),
          },
          {
            intent: input.intent as string | undefined,
            maxTokens: (input.maxTokens as number) || 500,
          },
        );

        return {
          success: true,
          compressed: result.content,
          originalSize: result.originalSizeBytes,
          compressedSize: result.sizeBytes,
          ratio: result.ratio.getPercentage(),
          passedThrough: result.passedThrough,
        };
      } catch (err) {
        return {
          success: false,
          error: `Compression failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  },
];
