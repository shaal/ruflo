/**
 * SnippetWindow — Immutable value object representing a contextual
 * extract from indexed content with relevance metadata.
 */

export type MatchLayer = 'stemming' | 'trigram' | 'fuzzy';

export interface Range {
  readonly start: number;
  readonly end: number;
}

export interface SnippetWindowProps {
  readonly text: string;
  readonly heading: string;
  readonly matchLayer: MatchLayer;
  readonly relevanceScore: number;
  readonly highlightRanges: readonly Range[];
}

export class SnippetWindow {
  readonly text: string;
  readonly heading: string;
  readonly matchLayer: MatchLayer;
  readonly relevanceScore: number;
  readonly highlightRanges: readonly Range[];

  private constructor(props: SnippetWindowProps) {
    this.text = props.text;
    this.heading = props.heading;
    this.matchLayer = props.matchLayer;
    this.relevanceScore = props.relevanceScore;
    this.highlightRanges = Object.freeze([...props.highlightRanges]);
  }

  static create(props: SnippetWindowProps): SnippetWindow {
    if (props.relevanceScore < 0 || props.relevanceScore > 1) {
      throw new RangeError('relevanceScore must be in [0, 1]');
    }
    return new SnippetWindow(props);
  }

  /** Rough token estimate: ceil(text.length / 4). */
  getTokenEstimate(): number {
    return Math.ceil(this.text.length / 4);
  }

  /** Value equality based on text, heading, matchLayer, and relevanceScore. */
  equals(other: SnippetWindow): boolean {
    return (
      this.text === other.text &&
      this.heading === other.heading &&
      this.matchLayer === other.matchLayer &&
      this.relevanceScore === other.relevanceScore
    );
  }
}
