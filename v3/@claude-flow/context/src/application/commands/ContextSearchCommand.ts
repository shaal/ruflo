/**
 * ContextSearchCommand — Formats unified search results
 * for CLI/dashboard output.
 */

export interface ISearchService {
  search(
    queries: string[],
    options?: { limit?: number },
  ): Promise<SearchOutput[]>;
}

export interface SearchOutput {
  content: string;
  heading: string;
  source: string;
  score: number;
  matchLayers: string[];
}

export async function contextSearch(
  searchService: ISearchService,
  queries: string[],
): Promise<string> {
  const results = await searchService.search(queries, { limit: 10 });

  if (results.length === 0) {
    return `No results found for: ${queries.join(', ')}`;
  }

  const lines: string[] = [];
  lines.push(`Search Results (${results.length} matches)`);
  lines.push('═'.repeat(50));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`${i + 1}. [${r.matchLayers.join(',')}] ${r.heading || '(no heading)'}`);
    lines.push(`   Score: ${r.score.toFixed(4)} | Source: ${r.source || 'unknown'}`);

    // Show first 120 chars of content as preview
    const preview = r.content.replace(/\n/g, ' ').slice(0, 120);
    lines.push(`   ${preview}${r.content.length > 120 ? '...' : ''}`);
    lines.push('');
  }

  return lines.join('\n');
}
