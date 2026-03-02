/**
 * @claude-flow/context — Context Optimization Engine
 *
 * Compression pipeline, FTS5 knowledge base, sandbox isolation,
 * and swarm-aware context budgets for claude-flow V3.
 *
 * @see ADR-059, ADR-059a, ADR-059b, ADR-059c
 */

// Domain — Value Objects
export { CompressionRatio } from './domain/value-objects/CompressionRatio.js';
export { ContextBudget, type ThrottleLevel } from './domain/value-objects/ContextBudget.js';
export { SearchQuery } from './domain/value-objects/SearchQuery.js';
export { SnippetWindow, type MatchLayer } from './domain/value-objects/SnippetWindow.js';

// Domain — Entities
export { KnowledgeChunk, type ChunkSource } from './domain/entities/KnowledgeChunk.js';
export { SandboxInstance, SandboxState, type RuntimeType } from './domain/entities/SandboxInstance.js';

// Domain — Aggregates
export { CompressionSession } from './domain/aggregates/CompressionSession.js';
export { KnowledgeBase } from './domain/aggregates/KnowledgeBase.js';

// Domain — Events
export type { DomainEvent } from './domain/events/DomainEvent.js';
export type { OutputCompressedEvent } from './domain/events/OutputCompressedEvent.js';
export { createOutputCompressedEvent } from './domain/events/OutputCompressedEvent.js';
export type { ContentIndexedEvent } from './domain/events/ContentIndexedEvent.js';
export { createContentIndexedEvent } from './domain/events/ContentIndexedEvent.js';
export type { BudgetExceededEvent } from './domain/events/BudgetExceededEvent.js';
export { createBudgetExceededEvent } from './domain/events/BudgetExceededEvent.js';
export type { ChunksEvictedEvent } from './domain/events/ChunksEvictedEvent.js';
export { createChunksEvictedEvent } from './domain/events/ChunksEvictedEvent.js';

// Domain — Repository Interfaces
export type { IFTS5Repository, RawSearchResult, KnowledgeChunkInput, EvictPredicate } from './domain/repositories/IFTS5Repository.js';
export type { ICompressionSessionRepository } from './domain/repositories/ICompressionSessionRepository.js';
export type { IContextBudgetRepository } from './domain/repositories/IContextBudgetRepository.js';

// Infrastructure
export { FTS5Repository } from './infrastructure/FTS5Repository.js';
export { ChunkingEngine } from './infrastructure/ChunkingEngine.js';
export { LevenshteinCorrector } from './infrastructure/LevenshteinCorrector.js';

// Sandbox
export { SandboxPool } from './sandbox/SandboxPool.js';
export { RuntimeDetector } from './sandbox/RuntimeDetector.js';
export { CredentialPassthrough } from './sandbox/CredentialPassthrough.js';

// Application
export { CompressionPipelineService } from './application/CompressionPipelineService.js';
export { FuzzySearchService } from './application/FuzzySearchService.js';
export { UnifiedSearchService } from './application/UnifiedSearchService.js';
export { MetricsCollector } from './application/MetricsCollector.js';

// Application — Commands
export { contextStats } from './application/commands/ContextStatsCommand.js';
export { contextDoctor } from './application/commands/ContextDoctorCommand.js';
export { contextSearch } from './application/commands/ContextSearchCommand.js';

// Hooks
export { PreToolUseHook } from './hooks/PreToolUseHook.js';
export { PostToolUseHook } from './hooks/PostToolUseHook.js';
export { SubagentRoutingHook } from './hooks/SubagentRoutingHook.js';

// Budgets
export {
  ContextBudgetManager,
  ThrottleLevel as BudgetThrottleLevel,
  type IContextBudgetManager,
  type SwarmTopology,
  type ConsumeResult,
  type ReleaseResult,
  type BudgetCheckResult,
  type BudgetSnapshot,
  type AgentBudgetInfo,
} from './budgets/ContextBudgetManager.js';
export { SharedKnowledgeTracker } from './budgets/SharedKnowledgeTracker.js';
export {
  SwarmBudgetIntegration,
  type ISwarmEventBus,
} from './budgets/SwarmBudgetIntegration.js';
