/**
 * SharedKnowledgeTracker — Cross-agent content deduplication tracker.
 *
 * Tracks content hashes indexed by each agent so the shared FTS5
 * knowledge base avoids storing duplicate content across agents.
 */

export interface SharedKnowledgeStats {
  totalIndexed: number;
  deduplicatedCount: number;
}

export class SharedKnowledgeTracker {
  /** Set of all known content hashes. */
  private readonly allHashes = new Set<string>();

  /** Map of agentId → set of hashes that agent has indexed. */
  private readonly agentHashes = new Map<string, Set<string>>();

  /** Count of index operations that were deduped. */
  private deduplicatedCount = 0;

  /**
   * Check whether a content hash has already been indexed
   * by any agent.
   */
  hasContent(hash: string): boolean {
    return this.allHashes.has(hash);
  }

  /**
   * Record that an agent has indexed content with the given hash.
   * Returns `true` if this was new content, `false` if deduplicated.
   */
  recordIndex(agentId: string, hash: string): boolean {
    let agentSet = this.agentHashes.get(agentId);
    if (!agentSet) {
      agentSet = new Set<string>();
      this.agentHashes.set(agentId, agentSet);
    }

    // Already indexed by this agent — no-op
    if (agentSet.has(hash)) {
      return false;
    }

    agentSet.add(hash);

    if (this.allHashes.has(hash)) {
      // Another agent already has this content
      this.deduplicatedCount++;
      return false;
    }

    this.allHashes.add(hash);
    return true;
  }

  /**
   * Get deduplication statistics.
   */
  getStats(): SharedKnowledgeStats {
    return {
      totalIndexed: this.allHashes.size,
      deduplicatedCount: this.deduplicatedCount,
    };
  }

  /**
   * Get all hashes indexed by a specific agent.
   */
  getAgentHashes(agentId: string): ReadonlySet<string> {
    return this.agentHashes.get(agentId) ?? new Set();
  }

  /**
   * Clear all tracked state.
   */
  clear(): void {
    this.allHashes.clear();
    this.agentHashes.clear();
    this.deduplicatedCount = 0;
  }
}
