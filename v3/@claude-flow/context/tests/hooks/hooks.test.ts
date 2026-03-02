/**
 * Hook tests — PreToolUseHook, PostToolUseHook, SubagentRoutingHook.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PreToolUseHook,
  type IBudgetChecker,
} from '../../src/hooks/PreToolUseHook.js';
import { PostToolUseHook } from '../../src/hooks/PostToolUseHook.js';
import { SubagentRoutingHook } from '../../src/hooks/SubagentRoutingHook.js';
import type { ICompressionPipeline } from '../../src/application/CompressionPipelineService.js';
import { CompressionRatio } from '../../src/domain/value-objects/CompressionRatio.js';

// ─── PreToolUseHook ─────────────────────────────────────────────────

describe('PreToolUseHook', () => {
  let budgetChecker: IBudgetChecker;
  let hook: PreToolUseHook;

  beforeEach(() => {
    budgetChecker = {
      checkBudget: vi.fn().mockReturnValue({
        allowed: true,
        throttleLevel: 'normal',
        remaining: 10000,
        callCount: 1,
        message: null,
      }),
    };
    hook = new PreToolUseHook(budgetChecker);
  });

  it('should proceed when budget is normal', async () => {
    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: {},
      agentId: 'agent-1',
    });

    expect(result.action).toBe('proceed');
    expect(result.message).toBeUndefined();
  });

  it('should proceed without check when no agentId', async () => {
    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: {},
    });

    expect(result.action).toBe('proceed');
    expect(budgetChecker.checkBudget).not.toHaveBeenCalled();
  });

  it('should suggest alternative when budget is blocked', async () => {
    (budgetChecker.checkBudget as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: false,
      throttleLevel: 'blocked',
      remaining: 0,
      callCount: 15,
      message: 'Blocked',
    });

    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: {},
      agentId: 'agent-1',
    });

    expect(result.action).toBe('suggest_alternative');
    expect(result.suggestedTool).toBe('batch_execute');
  });

  it('should proceed with warning when budget is reduced', async () => {
    (budgetChecker.checkBudget as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: true,
      throttleLevel: 'reduced',
      remaining: 5000,
      callCount: 5,
      message: null,
    });

    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: {},
      agentId: 'agent-1',
    });

    expect(result.action).toBe('proceed');
    expect(result.message).toContain('reduced');
  });

  it('should proceed with warning when budget is minimal', async () => {
    (budgetChecker.checkBudget as ReturnType<typeof vi.fn>).mockReturnValue({
      allowed: true,
      throttleLevel: 'minimal',
      remaining: 1000,
      callCount: 10,
      message: null,
    });

    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: {},
      agentId: 'agent-1',
    });

    expect(result.action).toBe('proceed');
    expect(result.message).toContain('nearly exhausted');
  });
});

// ─── PostToolUseHook ────────────────────────────────────────────────

describe('PostToolUseHook', () => {
  let pipeline: ICompressionPipeline;
  let hook: PostToolUseHook;

  beforeEach(() => {
    pipeline = {
      compress: vi.fn().mockResolvedValue({
        content: 'compressed',
        toolName: 'Read',
        sizeBytes: 100,
        originalSizeBytes: 1000,
        ratio: CompressionRatio.create(1000, 100),
        passedThrough: false,
      }),
      getStats: vi.fn().mockReturnValue({
        totalCompressions: 0,
        totalRawBytes: 0,
        totalCompressedBytes: 0,
        overallRatio: 0,
      }),
      reset: vi.fn(),
    };
    hook = new PostToolUseHook(pipeline);
  });

  it('should compress output via pipeline', async () => {
    const result = await hook.handle({
      toolName: 'Read',
      output: 'large output content',
      outputSize: 1000,
      agentId: 'agent-1',
    });

    expect(result.compressed).toBe(true);
    expect(result.output).toBe('compressed');
    expect(result.originalSize).toBe(1000);
    expect(result.compressedSize).toBe(100);
  });

  it('should pass through when pipeline reports passthrough', async () => {
    (pipeline.compress as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: 'small output',
      toolName: 'Read',
      sizeBytes: 50,
      originalSizeBytes: 50,
      ratio: CompressionRatio.none(),
      passedThrough: true,
    });

    const result = await hook.handle({
      toolName: 'Read',
      output: 'small output',
      outputSize: 50,
    });

    expect(result.compressed).toBe(false);
    expect(result.output).toBe('small output');
  });

  it('should pass intent to the pipeline', async () => {
    await hook.handle({
      toolName: 'Read',
      output: 'content',
      outputSize: 5000,
      intent: 'authentication',
    });

    expect(pipeline.compress).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'Read' }),
      expect.objectContaining({ intent: 'authentication' }),
    );
  });
});

// ─── SubagentRoutingHook ────────────────────────────────────────────

describe('SubagentRoutingHook', () => {
  let hook: SubagentRoutingHook;

  beforeEach(() => {
    hook = new SubagentRoutingHook();
  });

  it('should inject routing instructions for Agent tool', async () => {
    const result = await hook.handle({
      toolName: 'Agent',
      toolArgs: { prompt: 'Do some work' },
    });

    expect(result.action).toBe('modify_args');
    expect(result.modifiedArgs!['prompt']).toContain('batch_execute');
    expect(result.modifiedArgs!['prompt']).toContain('Do some work');
  });

  it('should inject routing instructions for Task tool', async () => {
    const result = await hook.handle({
      toolName: 'Task',
      toolArgs: { description: 'Build feature' },
    });

    expect(result.action).toBe('modify_args');
    expect(result.modifiedArgs!['description']).toContain('batch_execute');
  });

  it('should proceed without modification for non-Agent tools', async () => {
    const result = await hook.handle({
      toolName: 'Read',
      toolArgs: { file: 'test.ts' },
    });

    expect(result.action).toBe('proceed');
    expect(result.modifiedArgs).toBeUndefined();
  });

  it('should handle missing prompt field gracefully', async () => {
    const result = await hook.handle({
      toolName: 'Agent',
      toolArgs: { someOtherField: 123 },
    });

    expect(result.action).toBe('modify_args');
    // Args should still be returned even if no prompt found to modify
    expect(result.modifiedArgs).toBeDefined();
  });

  it('should have static ROUTING_INSTRUCTIONS', () => {
    expect(SubagentRoutingHook.ROUTING_INSTRUCTIONS).toContain('batch_execute');
  });
});
