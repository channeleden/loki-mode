/**
 * Circuit breaker for provider reliability
 * Prevents cascading failures by failing fast when a provider is unhealthy
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Number of failures before opening circuit */
  failureThreshold?: number;
  /** Time to wait before attempting half-open state (ms) */
  resetTimeout?: number;
  /** Number of successes required to close circuit from half-open */
  successThreshold?: number;
  /** Time window for counting failures (ms) */
  failureWindow?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  lastSuccessTime: number | null;
  totalRequests: number;
  totalFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastStateChange: number = Date.now();
  private totalRequests: number = 0;
  private totalFailures: number = 0;

  private readonly threshold: number;
  private readonly resetTimeout: number;
  private readonly successThreshold: number;
  private readonly failureWindow: number;

  private failureTimestamps: number[] = [];

  constructor(config: CircuitBreakerConfig = {}) {
    this.threshold = config.failureThreshold ?? 5;
    this.resetTimeout = config.resetTimeout ?? 30000;
    this.successThreshold = config.successThreshold ?? 2;
    this.failureWindow = config.failureWindow ?? 60000;
  }

  /**
   * Execute a function with circuit breaker protection
   * @param fn Function to execute
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new CircuitOpenError(
        `Circuit is open. Reset in ${this.getTimeUntilReset()}ms`
      );
    }

    this.totalRequests++;

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check if circuit is open (not accepting requests)
   */
  isOpen(): boolean {
    if (this.state === 'OPEN') {
      // Check if we should transition to half-open
      const timeSinceStateChange = Date.now() - this.lastStateChange;
      if (timeSinceStateChange >= this.resetTimeout) {
        this.transitionTo('HALF_OPEN');
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Check if circuit is closed (accepting requests normally)
   */
  isClosed(): boolean {
    return this.state === 'CLOSED';
  }

  /**
   * Check if circuit is half-open (testing if provider recovered)
   */
  isHalfOpen(): boolean {
    return this.state === 'HALF_OPEN';
  }

  /**
   * Record a successful execution
   */
  recordSuccess(): void {
    this.lastSuccessTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transitionTo('CLOSED');
      }
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failures = 0;
      this.cleanupOldFailures();
    }
  }

  /**
   * Record a failed execution
   */
  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.totalFailures++;
    this.failureTimestamps.push(Date.now());

    if (this.state === 'HALF_OPEN') {
      // Any failure in half-open immediately opens the circuit
      this.transitionTo('OPEN');
    } else if (this.state === 'CLOSED') {
      this.cleanupOldFailures();
      this.failures = this.failureTimestamps.length;

      if (this.failures >= this.threshold) {
        this.transitionTo('OPEN');
      }
    }
  }

  /**
   * Remove failures outside the failure window
   */
  private cleanupOldFailures(): void {
    const now = Date.now();
    this.failureTimestamps = this.failureTimestamps.filter(
      (timestamp) => now - timestamp < this.failureWindow
    );
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChange = Date.now();

    if (newState === 'CLOSED') {
      this.failures = 0;
      this.successes = 0;
      this.failureTimestamps = [];
    } else if (newState === 'HALF_OPEN') {
      this.successes = 0;
    } else if (newState === 'OPEN') {
      this.successes = 0;
    }

    // Could emit event here for monitoring
    this.onStateChange?.(previousState, newState);
  }

  /**
   * Optional callback for state changes
   */
  onStateChange?: (previousState: CircuitState, newState: CircuitState) => void;

  /**
   * Get current state
   */
  getState(): CircuitState {
    // Check for automatic transition
    if (this.state === 'OPEN') {
      const timeSinceStateChange = Date.now() - this.lastStateChange;
      if (timeSinceStateChange >= this.resetTimeout) {
        this.transitionTo('HALF_OPEN');
      }
    }
    return this.state;
  }

  /**
   * Get time until circuit resets (when open)
   */
  getTimeUntilReset(): number {
    if (this.state !== 'OPEN') {
      return 0;
    }
    const elapsed = Date.now() - this.lastStateChange;
    return Math.max(0, this.resetTimeout - elapsed);
  }

  /**
   * Get circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failures: this.failures,
      successes: this.successes,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset(): void {
    this.transitionTo('CLOSED');
    this.totalRequests = 0;
    this.totalFailures = 0;
  }

  /**
   * Manually trip the circuit breaker
   */
  trip(): void {
    this.transitionTo('OPEN');
  }
}

/**
 * Error thrown when circuit is open
 */
export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
