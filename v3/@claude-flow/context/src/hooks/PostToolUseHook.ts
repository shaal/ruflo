/**
 * PostToolUseHook — Processes tool outputs through the compression
 * pipeline and indexes them in the knowledge base.
 *
 * Runs after each tool execution, compressing the output to fit
 * context budgets and making the full content searchable.
 *
 * @see ADR-059
 */

import type {
  ICompressionPipeline,
  CompressionOptions,
} from '../application/CompressionPipelineService.js';

// ─── Types ──────────────────────────────────────────────────────────

export interface PostToolUseEvent {
  toolName: string;
  output: string;
  outputSize: number;
  agentId?: string;
  intent?: string;
}

export interface PostToolUseResult {
  output: string;
  compressed: boolean;
  originalSize: number;
  compressedSize: number;
}

// ─── Implementation ─────────────────────────────────────────────────

export class PostToolUseHook {
  constructor(private readonly pipeline: ICompressionPipeline) {}

  async handle(event: PostToolUseEvent): Promise<PostToolUseResult> {
    const options: CompressionOptions = {
      ...(event.intent ? { intent: event.intent } : {}),
    };

    const result = await this.pipeline.compress(
      {
        content: event.output,
        toolName: event.toolName,
        sizeBytes: event.outputSize,
        agentId: event.agentId,
      },
      options,
    );

    return {
      output: result.content,
      compressed: !result.passedThrough,
      originalSize: result.originalSizeBytes,
      compressedSize: result.sizeBytes,
    };
  }
}
