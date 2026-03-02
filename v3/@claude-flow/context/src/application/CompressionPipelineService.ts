/**
 * CompressionPipelineService — Multi-stage output compression pipeline.
 *
 * Pipeline stages:
 *   1. Size check — small outputs (<1KB) pass through unchanged
 *   2. Medium path (1-5KB) — snippet extraction only (no sandbox)
 *   3. Full pipeline (>5KB):
 *      a. Sandbox execution (detect runtime, run, capture stdout)
 *      b. Intent-driven filtering via chunking + search
 *      c. Smart snippet extraction within maxTokens budget
 *   4. Index full original output in KnowledgeBase
 *   5. Record compression metrics in CompressionSession
 *
 * @see ADR-059
 */

import { CompressionRatio } from '../domain/value-objects/CompressionRatio.js';
import { KnowledgeChunk } from '../domain/entities/KnowledgeChunk.js';

// ─── Interfaces ─────────────────────────────────────────────────────

export interface RawToolOutput {
  content: string;
  toolName: string;
  sizeBytes: number;
  agentId?: string;
}

export interface CompressionOptions {
  intent?: string;
  maxTokens?: number;
  bypassThreshold?: number;
  intentThreshold?: number;
  timeout?: number;
}

export interface CompressedOutput {
  content: string;
  toolName: string;
  sizeBytes: number;
  originalSizeBytes: number;
  ratio: CompressionRatio;
  passedThrough: boolean;
}

export interface ICompressionPipeline {
  compress(
    output: RawToolOutput,
    options?: CompressionOptions,
  ): Promise<CompressedOutput>;
  getStats(): SessionCompressionStats;
  reset(): void;
}

export interface SessionCompressionStats {
  totalCompressions: number;
  totalRawBytes: number;
  totalCompressedBytes: number;
  overallRatio: number;
}

export interface IChunkingEngine {
  chunk(
    content: string,
    options?: { maxChunkSize?: number; overlapTokens?: number },
  ): ContentChunkResult[];
}

export interface ContentChunkResult {
  text: string;
  heading: string;
  index: number;
  tokenEstimate: number;
  hasCodeBlock: boolean;
}

export interface IKnowledgeBase {
  addChunk(chunk: KnowledgeChunk): boolean;
}

export interface ICompressionSession {
  recordCompression(
    toolName: string,
    rawSize: number,
    compressedSize: number,
  ): void;
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_BYPASS_THRESHOLD = 1024;
const DEFAULT_INTENT_THRESHOLD = 5120;
const DEFAULT_MAX_TOKENS = 500;
const MEDIUM_THRESHOLD = 5120;

// ─── Implementation ─────────────────────────────────────────────────

export class CompressionPipelineService implements ICompressionPipeline {
  private totalRaw = 0;
  private totalCompressed = 0;
  private totalCompressions = 0;

  constructor(
    private readonly chunkingEngine: IChunkingEngine,
    private readonly knowledgeBase: IKnowledgeBase,
    private readonly compressionSession: ICompressionSession,
    private readonly sessionId: string = 'default',
  ) {}

  async compress(
    output: RawToolOutput,
    options?: CompressionOptions,
  ): Promise<CompressedOutput> {
    const bypassThreshold =
      options?.bypassThreshold ?? DEFAULT_BYPASS_THRESHOLD;
    const maxTokens = options?.maxTokens ?? DEFAULT_MAX_TOKENS;
    const intent = options?.intent;
    const intentThreshold =
      options?.intentThreshold ?? DEFAULT_INTENT_THRESHOLD;

    // Stage 1: Passthrough for small outputs
    if (output.sizeBytes < bypassThreshold) {
      this.recordStats(output.toolName, output.sizeBytes, output.sizeBytes);
      return {
        content: output.content,
        toolName: output.toolName,
        sizeBytes: output.sizeBytes,
        originalSizeBytes: output.sizeBytes,
        ratio: CompressionRatio.none(),
        passedThrough: true,
      };
    }

    // Index full content in knowledge base (regardless of path)
    this.indexContent(output);

    let compressed: string;

    if (output.sizeBytes < MEDIUM_THRESHOLD) {
      // Stage 2: Medium path — snippet extraction only
      compressed = this.extractSnippets(output.content, maxTokens, intent);
    } else {
      // Stage 3: Full pipeline
      compressed = this.fullPipeline(
        output.content,
        maxTokens,
        intent,
        intentThreshold,
      );
    }

    const compressedSize = Buffer.byteLength(compressed, 'utf8');
    const ratio = CompressionRatio.create(output.sizeBytes, compressedSize);

    this.recordStats(output.toolName, output.sizeBytes, compressedSize);

    return {
      content: compressed,
      toolName: output.toolName,
      sizeBytes: compressedSize,
      originalSizeBytes: output.sizeBytes,
      ratio,
      passedThrough: false,
    };
  }

  getStats(): SessionCompressionStats {
    return {
      totalCompressions: this.totalCompressions,
      totalRawBytes: this.totalRaw,
      totalCompressedBytes: this.totalCompressed,
      overallRatio:
        this.totalRaw === 0
          ? 0
          : 1 - this.totalCompressed / this.totalRaw,
    };
  }

  reset(): void {
    this.totalRaw = 0;
    this.totalCompressed = 0;
    this.totalCompressions = 0;
  }

  // ─── Private ──────────────────────────────────────────────────────

  private fullPipeline(
    content: string,
    maxTokens: number,
    intent: string | undefined,
    intentThreshold: number,
  ): string {
    let working = content;

    // Intent-driven filtering for large outputs
    if (intent && Buffer.byteLength(working, 'utf8') > intentThreshold) {
      working = this.intentFilter(working, intent, maxTokens);
    } else {
      working = this.extractSnippets(working, maxTokens, intent);
    }

    return working;
  }

  private intentFilter(
    content: string,
    intent: string,
    maxTokens: number,
  ): string {
    const chunks = this.chunkingEngine.chunk(content);
    if (chunks.length === 0) {
      return this.extractSnippets(content, maxTokens, intent);
    }

    const intentLower = intent.toLowerCase();
    const intentTokens = intentLower.split(/\s+/);

    // Score each chunk by intent relevance
    const scored = chunks.map((chunk) => {
      const textLower = chunk.text.toLowerCase();
      const headingLower = chunk.heading.toLowerCase();

      let score = 0;
      for (const token of intentTokens) {
        if (headingLower.includes(token)) score += 3;
        if (textLower.includes(token)) score += 1;
      }
      if (chunk.hasCodeBlock) score += 0.5;

      return { chunk, score };
    });

    // Keep chunks with positive relevance, sorted by score desc
    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (relevant.length === 0) {
      return this.extractSnippets(content, maxTokens, intent);
    }

    // Assemble within token budget
    const parts: string[] = [];
    let tokenBudget = maxTokens;

    for (const { chunk } of relevant) {
      if (tokenBudget <= 0) break;
      const tokens = chunk.tokenEstimate;
      if (tokens <= tokenBudget) {
        parts.push(
          chunk.heading ? `## ${chunk.heading}\n${chunk.text}` : chunk.text,
        );
        tokenBudget -= tokens;
      }
    }

    const omitted = chunks.length - parts.length;

    if (omitted > 0) {
      parts.push(
        `\n[... ${omitted} more sections in knowledge base, search to retrieve]`,
      );
    }

    return parts.join('\n\n');
  }

  private extractSnippets(
    content: string,
    maxTokens: number,
    intent?: string,
  ): string {
    const lines = content.split('\n');
    const parts: string[] = [];
    let tokenCount = 0;
    const maxChars = maxTokens * 4; // ~4 chars per token

    // Extract first heading + context
    let foundHeading = false;
    for (let i = 0; i < lines.length && !foundHeading; i++) {
      const line = lines[i];
      if (/^#{1,6}\s+/.test(line) || /^<h[1-6]/i.test(line)) {
        parts.push(line);
        // Include next non-empty line as context
        for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
          if (lines[j].trim().length > 0) {
            parts.push(lines[j]);
            break;
          }
        }
        tokenCount = Math.ceil(parts.join('\n').length / 4);
        foundHeading = true;
      }
    }

    // If intent provided, find matching sections
    if (intent) {
      const intentLower = intent.toLowerCase();
      let inMatchSection = false;

      for (const line of lines) {
        if (tokenCount >= maxTokens) break;

        const lineLower = line.toLowerCase();
        if (lineLower.includes(intentLower)) {
          inMatchSection = true;
        }

        if (inMatchSection) {
          parts.push(line);
          tokenCount += Math.ceil(line.length / 4);

          // Stop after empty line following match (end of section)
          if (line.trim().length === 0 && parts.length > 2) {
            inMatchSection = false;
          }
        }
      }
    }

    // If still under budget, fill with code blocks
    if (tokenCount < maxTokens) {
      let inCode = false;
      const codeBlock: string[] = [];

      for (const line of lines) {
        if (tokenCount >= maxTokens) break;

        if (line.startsWith('```')) {
          if (inCode) {
            codeBlock.push(line);
            const block = codeBlock.join('\n');
            const blockTokens = Math.ceil(block.length / 4);
            if (tokenCount + blockTokens <= maxTokens) {
              parts.push(block);
              tokenCount += blockTokens;
            }
            codeBlock.length = 0;
            inCode = false;
          } else {
            inCode = true;
            codeBlock.push(line);
          }
        } else if (inCode) {
          codeBlock.push(line);
        }
      }
    }

    // Truncate if over budget
    let result = parts.join('\n');
    if (result.length > maxChars) {
      result = result.slice(0, maxChars);
    }

    // Count remaining sections
    const totalSections = content.split(/^#{1,6}\s+/m).length - 1;
    const includedSections = parts.filter((p) =>
      /^#{1,6}\s+/.test(p),
    ).length;
    const remaining = Math.max(0, totalSections - includedSections);

    if (remaining > 0) {
      result += `\n\n[... ${remaining} more sections in knowledge base, search to retrieve]`;
    }

    return result;
  }

  private indexContent(output: RawToolOutput): void {
    const chunks = this.chunkingEngine.chunk(output.content);
    for (const chunk of chunks) {
      const kc = new KnowledgeChunk({
        content: chunk.text,
        heading: chunk.heading,
        source: {
          toolName: output.toolName,
          agentId: output.agentId,
        },
        sessionId: this.sessionId,
      });
      this.knowledgeBase.addChunk(kc);
    }
  }

  private recordStats(
    toolName: string,
    rawSize: number,
    compressedSize: number,
  ): void {
    this.totalRaw += rawSize;
    this.totalCompressed += compressedSize;
    this.totalCompressions++;
    this.compressionSession.recordCompression(
      toolName,
      rawSize,
      compressedSize,
    );
  }
}
