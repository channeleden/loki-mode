/**
 * Token bucket rate limiter for API request throttling
 */

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number; // Tokens per millisecond
  private lastRefillTime: number;
  private waitQueue: Array<{
    count: number;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private refillInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Create a new rate limiter
   * @param maxTokens Maximum tokens in the bucket
   * @param refillRatePerSecond Tokens added per second
   */
  constructor(maxTokens: number = 100, refillRatePerSecond: number = 10) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond / 1000;
    this.lastRefillTime = Date.now();
    this.startRefillTimer();
  }

  /**
   * Start the background refill timer
   */
  private startRefillTimer(): void {
    if (this.refillInterval) {
      return;
    }

    this.refillInterval = setInterval(() => {
      this.refill();
      this.processQueue();
    }, 100); // Check every 100ms
  }

  /**
   * Stop the background refill timer
   */
  public stop(): void {
    if (this.refillInterval) {
      clearInterval(this.refillInterval);
      this.refillInterval = null;
    }

    // Reject any pending requests
    for (const waiter of this.waitQueue) {
      waiter.reject(new Error('Rate limiter stopped'));
    }
    this.waitQueue = [];
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /**
   * Process waiting requests in queue
   */
  private processQueue(): void {
    while (this.waitQueue.length > 0) {
      const next = this.waitQueue[0];

      if (this.tokens >= next.count) {
        this.tokens -= next.count;
        this.waitQueue.shift();
        next.resolve();
      } else {
        // Not enough tokens for next request, stop processing
        break;
      }
    }
  }

  /**
   * Acquire tokens from the bucket
   * Will wait if insufficient tokens are available
   * @param count Number of tokens to acquire
   * @param timeout Maximum time to wait in milliseconds (default: 30000)
   */
  async acquire(count: number = 1, timeout: number = 30000): Promise<void> {
    if (count > this.maxTokens) {
      throw new Error(
        `Requested ${count} tokens exceeds max bucket size of ${this.maxTokens}`
      );
    }

    // Refill first
    this.refill();

    // Try immediate acquisition
    if (this.tokens >= count) {
      this.tokens -= count;
      return;
    }

    // Queue the request
    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = this.waitQueue.findIndex(
          (w) => w.resolve === resolve
        );
        if (index !== -1) {
          this.waitQueue.splice(index, 1);
        }
        reject(new Error(`Rate limit timeout after ${timeout}ms`));
      }, timeout);

      this.waitQueue.push({
        count,
        resolve: () => {
          clearTimeout(timeoutId);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
    });
  }

  /**
   * Release tokens back to the bucket
   * Useful for cancellation or when operation uses fewer tokens than expected
   * @param count Number of tokens to release
   */
  release(count: number = 1): void {
    this.tokens = Math.min(this.maxTokens, this.tokens + count);
    this.processQueue();
  }

  /**
   * Get current available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.waitQueue.length;
  }

  /**
   * Check if tokens are immediately available
   * @param count Number of tokens to check
   */
  canAcquire(count: number = 1): boolean {
    this.refill();
    return this.tokens >= count;
  }
}

/**
 * Create a rate limiter configured for requests per minute
 * @param rpm Requests per minute
 */
export function createRpmLimiter(rpm: number): RateLimiter {
  return new RateLimiter(rpm, rpm / 60);
}

/**
 * Create a rate limiter configured for tokens per minute
 * @param tpm Tokens per minute
 */
export function createTpmLimiter(tpm: number): RateLimiter {
  return new RateLimiter(tpm, tpm / 60);
}
