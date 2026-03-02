/**
 * Base domain event interface.
 *
 * All domain events carry a `type` discriminator and the
 * timestamp at which the event occurred.
 */
export interface DomainEvent {
  readonly type: string;
  readonly occurredAt: Date;
}
