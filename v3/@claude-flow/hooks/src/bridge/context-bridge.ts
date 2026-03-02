/**
 * Context Optimization Hook Bridge
 *
 * Registers @claude-flow/context hook classes (PreToolUseHook,
 * PostToolUseHook, SubagentRoutingHook) into the V3 HookRegistry.
 *
 * Uses lazy dynamic import so the system works fine without
 * @claude-flow/context installed — silently skips registration.
 *
 * @see ADR-059
 * @module v3/hooks/bridge/context-bridge
 */

import { HookEvent, HookPriority, type HookHandler, type HookContext, type HookResult } from '../types.js';
import type { HookRegistry } from '../registry/index.js';

/**
 * Register context optimization hooks into the given HookRegistry.
 *
 * Creates a shared service bundle (lazy singleton) and adapts the
 * three context hook classes to the V3 HookHandler signature.
 */
export async function registerContextHooks(registry: HookRegistry): Promise<void> {
  // Dynamic import — silently skip if @claude-flow/context is not available
  let ctx: typeof import('@claude-flow/context');
  try {
    ctx = await import('@claude-flow/context');
  } catch {
    // @claude-flow/context not installed — skip registration
    return;
  }

  // ─── Service Singletons ──────────────────────────────────────────

  const fts5Repo = new ctx.FTS5Repository();
  await fts5Repo.init();

  const chunkingEngine = new ctx.ChunkingEngine();
  const levenshteinCorrector = new ctx.LevenshteinCorrector();

  const fuzzySearch = new ctx.FuzzySearchService(fts5Repo, levenshteinCorrector);
  const searchService = new ctx.UnifiedSearchService(fuzzySearch);

  const knowledgeBase = new ctx.KnowledgeBase();
  const compressionSession = new ctx.CompressionSession();
  const compressionPipeline = new ctx.CompressionPipelineService(
    chunkingEngine,
    knowledgeBase,
    compressionSession,
    knowledgeBase.sessionId,
  );

  const budgetManager = new ctx.ContextBudgetManager();

  // ─── Hook Instances ──────────────────────────────────────────────

  const preToolUseHook = new ctx.PreToolUseHook(budgetManager);
  const postToolUseHook = new ctx.PostToolUseHook(compressionPipeline);
  const subagentRoutingHook = new ctx.SubagentRoutingHook();

  // ─── PreToolUse Adapter (Budget Enforcement) ─────────────────────

  const preToolUseHandler: HookHandler = async (hookCtx: HookContext): Promise<HookResult> => {
    const event = {
      toolName: hookCtx.tool?.name ?? 'unknown',
      toolArgs: hookCtx.tool?.parameters ?? {},
      agentId: hookCtx.agent?.id,
    };

    const result = await preToolUseHook.handle(event);

    return {
      success: true,
      abort: result.action === 'suggest_alternative',
      message: result.message,
      data: result.suggestedTool
        ? { suggestedTool: result.suggestedTool, modifiedArgs: result.modifiedArgs }
        : undefined,
    };
  };

  registry.register(HookEvent.PreToolUse, preToolUseHandler, HookPriority.High, {
    name: 'context-budget-enforcement',
    description: 'Enforces per-agent context budget limits (ADR-059c)',
  });

  // ─── PostToolUse Adapter (Compression) ───────────────────────────

  const postToolUseHandler: HookHandler = async (hookCtx: HookContext): Promise<HookResult> => {
    const toolOutput = hookCtx.command?.output ?? '';

    // Skip if no output to compress
    if (!toolOutput) {
      return { success: true };
    }

    const event = {
      toolName: hookCtx.tool?.name ?? 'unknown',
      output: toolOutput,
      outputSize: Buffer.byteLength(toolOutput, 'utf-8'),
      agentId: hookCtx.agent?.id,
      intent: hookCtx.routing?.task,
    };

    const result = await postToolUseHook.handle(event);

    return {
      success: true,
      data: {
        compressedOutput: result.output,
        compressed: result.compressed,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize,
      },
    };
  };

  registry.register(HookEvent.PostToolUse, postToolUseHandler, HookPriority.Normal, {
    name: 'context-compression',
    description: 'Compresses tool outputs and indexes them in the knowledge base (ADR-059)',
  });

  // ─── AgentSpawn Adapter (Subagent Routing) ───────────────────────

  const agentSpawnHandler: HookHandler = async (hookCtx: HookContext): Promise<HookResult> => {
    const event = {
      toolName: hookCtx.tool?.name ?? 'Task',
      toolArgs: hookCtx.tool?.parameters ?? {},
      agentId: hookCtx.agent?.id,
    };

    const result = await subagentRoutingHook.handle(event);

    return {
      success: true,
      data: result.action === 'modify_args'
        ? { updatedInput: result.modifiedArgs }
        : undefined,
    };
  };

  registry.register(HookEvent.AgentSpawn, agentSpawnHandler, HookPriority.Normal, {
    name: 'context-subagent-routing',
    description: 'Injects batch operation hints into subagent prompts (ADR-059c)',
  });
}
