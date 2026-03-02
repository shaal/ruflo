/**
 * ChunkingEngine — Splits content into heading-bounded chunks with
 * code block preservation and configurable overlap.
 *
 * Algorithm:
 * 1. Parse content line by line
 * 2. Detect headings: `#`-prefixed Markdown or `<h1>`-`<h6>` HTML tags
 * 3. Track fenced code block boundaries (```) — never split within
 * 4. When a new heading appears outside a code block, start a new chunk
 * 5. Oversized chunks are split at paragraph boundaries (double newline)
 * 6. Overlap tokens from the previous chunk are prepended to the next
 *
 * @see ADR-059a §4.2
 */

/**
 * A single content chunk produced by the engine.
 */
export interface ContentChunk {
  text: string;
  heading: string;
  index: number;
  tokenEstimate: number;
  hasCodeBlock: boolean;
}

/**
 * Options controlling chunking behavior.
 */
export interface ChunkOptions {
  /** Maximum chunk size in estimated tokens (chars/4). Default: 2048. */
  maxChunkSize?: number;
  /** Number of overlap tokens between consecutive chunks. Default: 128. */
  overlapTokens?: number;
  /** Preserve fenced code blocks (never split within them). Default: true. */
  preserveCodeBlocks?: boolean;
}

const DEFAULT_MAX_CHUNK_SIZE = 2048;
const DEFAULT_OVERLAP_TOKENS = 128;

const MARKDOWN_HEADING_RE = /^(#{1,6})\s+(.+)/;
const HTML_HEADING_RE = /^<h([1-6])[^>]*>(.+?)<\/h\1>/i;
const FENCE_RE = /^```/;

export class ChunkingEngine {
  /**
   * Split content into heading-bounded chunks.
   */
  chunk(content: string, options?: ChunkOptions): ContentChunk[] {
    if (!content || content.trim().length === 0) {
      return [];
    }

    const maxTokens = options?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
    const overlapTokens = options?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    const preserveCode = options?.preserveCodeBlocks ?? true;

    const lines = content.split('\n');
    const rawSections = this.splitByHeadings(lines, preserveCode);

    // Post-process: enforce maxChunkSize, apply overlap
    const chunks: ContentChunk[] = [];
    let globalIndex = 0;

    for (const section of rawSections) {
      const sectionChunks = this.enforceSizeLimit(
        section.text,
        section.heading,
        section.hasCodeBlock,
        maxTokens,
      );

      for (const sc of sectionChunks) {
        const text =
          globalIndex > 0 && overlapTokens > 0
            ? this.applyOverlap(chunks[globalIndex - 1].text, sc.text, overlapTokens)
            : sc.text;

        chunks.push({
          text,
          heading: sc.heading,
          index: globalIndex,
          tokenEstimate: this.estimateTokens(text),
          hasCodeBlock: sc.hasCodeBlock,
        });
        globalIndex++;
      }
    }

    return chunks;
  }

  /**
   * Split lines into heading-bounded sections, preserving code blocks.
   */
  private splitByHeadings(
    lines: string[],
    preserveCode: boolean,
  ): Array<{ text: string; heading: string; hasCodeBlock: boolean }> {
    const sections: Array<{
      lines: string[];
      heading: string;
      hasCodeBlock: boolean;
    }> = [];

    let currentLines: string[] = [];
    let currentHeading = '';
    let inCodeBlock = false;
    let hasCodeBlock = false;

    for (const line of lines) {
      // Track fenced code blocks
      if (preserveCode && FENCE_RE.test(line)) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) hasCodeBlock = true;
        currentLines.push(line);
        continue;
      }

      // Inside a code block — never split
      if (inCodeBlock) {
        currentLines.push(line);
        continue;
      }

      // Check for heading
      const heading = this.extractHeading(line);
      if (heading !== null) {
        // Flush current section
        if (currentLines.length > 0) {
          sections.push({
            lines: currentLines,
            heading: currentHeading,
            hasCodeBlock,
          });
        }
        // Start new section
        currentLines = [line];
        currentHeading = heading;
        hasCodeBlock = false;
        continue;
      }

      currentLines.push(line);
    }

    // Flush final section
    if (currentLines.length > 0) {
      sections.push({
        lines: currentLines,
        heading: currentHeading,
        hasCodeBlock,
      });
    }

    return sections.map((s) => ({
      text: s.lines.join('\n'),
      heading: s.heading,
      hasCodeBlock: s.hasCodeBlock,
    }));
  }

  /**
   * Extract a heading string from a line, or return null.
   */
  private extractHeading(line: string): string | null {
    const mdMatch = MARKDOWN_HEADING_RE.exec(line);
    if (mdMatch) return mdMatch[2].trim();

    const htmlMatch = HTML_HEADING_RE.exec(line);
    if (htmlMatch) return htmlMatch[2].trim();

    return null;
  }

  /**
   * If a section exceeds maxTokens, split at paragraph boundaries.
   */
  private enforceSizeLimit(
    text: string,
    heading: string,
    hasCodeBlock: boolean,
    maxTokens: number,
  ): Array<{ text: string; heading: string; hasCodeBlock: boolean }> {
    if (this.estimateTokens(text) <= maxTokens) {
      return [{ text, heading, hasCodeBlock }];
    }

    // Split at paragraph boundaries (double newline)
    const paragraphs = text.split(/\n\n+/);
    const result: Array<{ text: string; heading: string; hasCodeBlock: boolean }> = [];
    let buffer = '';

    for (const para of paragraphs) {
      const candidate = buffer ? buffer + '\n\n' + para : para;

      if (this.estimateTokens(candidate) > maxTokens && buffer.length > 0) {
        result.push({
          text: buffer,
          heading,
          hasCodeBlock: this.containsCodeFence(buffer),
        });
        buffer = para;
      } else {
        buffer = candidate;
      }
    }

    if (buffer.length > 0) {
      result.push({
        text: buffer,
        heading,
        hasCodeBlock: this.containsCodeFence(buffer),
      });
    }

    return result;
  }

  /**
   * Prepend the last N overlap tokens from the previous chunk.
   */
  private applyOverlap(
    prevText: string,
    currentText: string,
    overlapTokens: number,
  ): string {
    const overlapChars = overlapTokens * 4; // reverse token estimation
    if (prevText.length <= overlapChars) {
      return prevText + '\n' + currentText;
    }
    const tail = prevText.slice(-overlapChars);
    return tail + '\n' + currentText;
  }

  /**
   * Estimate token count: ceil(chars / 4).
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Check if text contains a fenced code block marker.
   */
  private containsCodeFence(text: string): boolean {
    return text.includes('```');
  }
}
