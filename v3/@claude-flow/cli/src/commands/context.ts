/**
 * V3 CLI Context Command
 * Context optimization engine — compression, search, budget management
 *
 * Delegates to MCP tools per ADR-005 (CLI as thin wrapper).
 *
 * @see ADR-059: Context Optimization Engine
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { callMCPTool } from '../mcp-client.js';

// ─── Subcommands ────────────────────────────────────────────────────

const statsCommand: Command = {
  name: 'stats',
  description: 'Show context compression statistics',
  options: [],
  examples: [
    { command: 'claude-flow context stats', description: 'Show compression stats for current session' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    const result = await callMCPTool<{ success: boolean; output?: string; error?: string }>('context_stats');

    if (!result.success) {
      output.error(result.error || 'Failed to get context stats');
      return { success: false, message: result.error };
    }

    output.info(result.output || 'No stats available.');
    return { success: true };
  },
};

const searchCommand: Command = {
  name: 'search',
  description: 'Search the context knowledge base',
  options: [
    { name: 'query', short: 'q', type: 'string', description: 'Search query', required: true },
    { name: 'limit', short: 'l', type: 'number', description: 'Max results', default: 10 },
  ],
  examples: [
    { command: 'claude-flow context search --query "auth"', description: 'Search for auth-related context' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const query = ctx.flags.query as string;
    const limit = (ctx.flags.limit as number) || 10;

    const result = await callMCPTool<{ success: boolean; output?: string; error?: string }>(
      'context_search',
      { query, limit },
    );

    if (!result.success) {
      output.error(result.error || 'Search failed');
      return { success: false, message: result.error };
    }

    output.info(result.output || 'No results found.');
    return { success: true };
  },
};

const doctorCommand: Command = {
  name: 'doctor',
  description: 'Run context engine diagnostics',
  options: [],
  examples: [
    { command: 'claude-flow context doctor', description: 'Check context engine health' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    const result = await callMCPTool<{ success: boolean; output?: string; error?: string }>('context_doctor');

    if (!result.success) {
      output.error(result.error || 'Doctor check failed');
      return { success: false, message: result.error };
    }

    output.info(result.output || 'Diagnostics complete.');
    return { success: true };
  },
};

const budgetCommand: Command = {
  name: 'budget',
  description: 'Show context budget allocation and usage',
  options: [],
  examples: [
    { command: 'claude-flow context budget', description: 'Show per-agent budget allocation' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    const result = await callMCPTool<{ success: boolean; budget?: unknown; error?: string }>('context_budget');

    if (!result.success) {
      output.error(result.error || 'Budget query failed');
      return { success: false, message: result.error };
    }

    output.json(result.budget || {});
    return { success: true };
  },
};

const compressCommand: Command = {
  name: 'compress',
  description: 'Compress content through the optimization pipeline',
  options: [
    { name: 'file', short: 'f', type: 'string', description: 'File path to compress' },
    { name: 'content', short: 'c', type: 'string', description: 'Inline content to compress' },
    { name: 'intent', short: 'i', type: 'string', description: 'Intent for guided compression' },
    { name: 'max-tokens', short: 'm', type: 'number', description: 'Maximum tokens in output', default: 500 },
  ],
  examples: [
    { command: 'claude-flow context compress --file ./output.log --intent "errors"', description: 'Compress a log file keeping error sections' },
    { command: 'claude-flow context compress --content "..." --max-tokens 200', description: 'Compress inline content' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const file = ctx.flags.file as string | undefined;
    const content = ctx.flags.content as string | undefined;
    const intent = ctx.flags.intent as string | undefined;
    const maxTokens = (ctx.flags['max-tokens'] as number) || 500;

    if (!file && !content) {
      output.error('Either --file or --content must be provided');
      return { success: false, message: 'Missing input' };
    }

    const result = await callMCPTool<{
      success: boolean;
      compressed?: string;
      originalSize?: number;
      compressedSize?: number;
      ratio?: number;
      passedThrough?: boolean;
      error?: string;
    }>('context_compress', { file, content, intent, maxTokens });

    if (!result.success) {
      output.error(result.error || 'Compression failed');
      return { success: false, message: result.error };
    }

    if (result.passedThrough) {
      output.info('Content below bypass threshold — passed through unchanged.');
    } else {
      output.success(
        `Compressed: ${result.originalSize}B → ${result.compressedSize}B (${result.ratio?.toFixed(1)}% reduction)`,
      );
    }

    if (result.compressed) {
      output.info(result.compressed);
    }

    return { success: true };
  },
};

// ─── Parent Command ─────────────────────────────────────────────────

export const contextCommand: Command = {
  name: 'context',
  description: 'Context optimization engine — compression, search, budgets (ADR-059)',
  options: [],
  subcommands: [statsCommand, searchCommand, doctorCommand, budgetCommand, compressCommand],
  examples: [
    { command: 'claude-flow context stats', description: 'Show compression statistics' },
    { command: 'claude-flow context search --query "auth"', description: 'Search knowledge base' },
    { command: 'claude-flow context doctor', description: 'Run engine diagnostics' },
    { command: 'claude-flow context budget', description: 'Show budget allocation' },
    { command: 'claude-flow context compress --file log.txt', description: 'Compress a file' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.info('Context Optimization Engine (ADR-059)');
    output.info('');
    output.info('Subcommands:');
    output.info('  stats     Show compression statistics');
    output.info('  search    Search the knowledge base');
    output.info('  doctor    Run engine diagnostics');
    output.info('  budget    Show budget allocation');
    output.info('  compress  Compress content through the pipeline');
    output.info('');
    output.info('Use --help with any subcommand for details.');
    return { success: true };
  },
};

export default contextCommand;
