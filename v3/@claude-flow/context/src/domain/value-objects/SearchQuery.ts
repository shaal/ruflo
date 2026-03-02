/**
 * SearchQuery — Immutable value object encapsulating a search query
 * with normalization, tokenization, and FTS5/trigram helpers.
 */
export class SearchQuery {
  private readonly raw: string;
  private readonly normalized: string;
  private readonly tokens: readonly string[];

  private constructor(raw: string) {
    this.raw = raw;
    this.normalized = raw.toLowerCase().trim();
    this.tokens = Object.freeze(
      this.normalized.split(/\s+/).filter((t) => t.length > 0),
    );
  }

  static create(query: string): SearchQuery {
    if (!query || query.trim().length === 0) {
      throw new Error('SearchQuery cannot be empty');
    }
    return new SearchQuery(query);
  }

  getRaw(): string {
    return this.raw;
  }

  getNormalized(): string {
    return this.normalized;
  }

  getTokens(): readonly string[] {
    return this.tokens;
  }

  getTokenCount(): number {
    return this.tokens.length;
  }

  /** Produce an FTS5 MATCH expression (tokens joined with AND). */
  toFTS5Match(): string {
    return this.tokens.join(' AND ');
  }

  /** Produce a trigram pattern from the normalized query. */
  toTrigramPattern(): string {
    return this.normalized;
  }

  /** Value equality based on normalized form. */
  equals(other: SearchQuery): boolean {
    return this.normalized === other.getNormalized();
  }
}
