export class RateLimitError extends Error {
  constructor(public readonly retryAfterSec: number) {
    super('rate limit exceeded');
    this.name = 'RateLimitError';
  }
}
