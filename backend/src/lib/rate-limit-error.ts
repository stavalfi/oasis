/**
 * rate-limit-error.ts
 *
 * Thrown when an upstream returns HTTP 429 after the transport's own retries are
 * exhausted. The consumer catches it to pause the partition for a fixed window
 * instead of tight-looping on redelivery. Lives in `lib` so both the AI client
 * (thrower) and the Kafka consumer (catcher) can depend on it without coupling
 * those layers together.
 */
export class RateLimitError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
