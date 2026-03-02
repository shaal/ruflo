/**
 * ICompressionSessionRepository — Repository interface for persisting compression sessions.
 */
import { type CompressionSession } from '../aggregates/CompressionSession.js';

export interface ICompressionSessionRepository {
  save(session: CompressionSession): Promise<void>;
  load(sessionId: string): Promise<CompressionSession | null>;
  getActiveSession(): Promise<CompressionSession | null>;
}
