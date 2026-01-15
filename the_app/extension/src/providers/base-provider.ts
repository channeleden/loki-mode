/**
 * Abstract base provider for AI model providers
 */

import { RateLimiter } from './rate-limiter';
import { CircuitBreaker } from './circuit-breaker';
import {
  Message,
  CompletionOptions,
  StreamChunk,
  TokenCost,
  ConfidenceTier,
  ProviderConfig,
  ProviderError,
  ModelInfo
} from './types';

export abstract class BaseProvider {
  protected apiKey: string;
  protected baseUrl?: string;
  protected timeout: number;
  protected maxRetries: number;
  protected rateLimiter: RateLimiter;
  protected circuitBreaker: CircuitBreaker;
  protected name: string;

  constructor(config: ProviderConfig, name: string) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 60000;
    this.maxRetries = config.maxRetries ?? 3;
    this.name = name;

    // Initialize rate limiter with configured limits
    const rpm = config.rateLimitRpm ?? 60;
    this.rateLimiter = new RateLimiter(rpm, rpm / 60);

    // Initialize circuit breaker
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeout: 30000,
      successThreshold: 2
    });
  }

  /**
   * Get provider name
   */
  getName(): string {
    return this.name;
  }

  /**
   * Check if provider is available
   */
  isAvailable(): boolean {
    return !this.circuitBreaker.isOpen();
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    return this.circuitBreaker.getState();
  }

  /**
   * Complete a conversation with streaming response
   * @param messages Conversation messages
   * @param options Completion options
   */
  abstract complete(
    messages: Message[],
    options?: CompletionOptions
  ): AsyncGenerator<StreamChunk>;

  /**
   * Count tokens in text
   * @param text Text to count tokens for
   */
  abstract countTokens(text: string): number;

  /**
   * Get the appropriate model for a confidence tier
   * @param tier Confidence tier
   */
  abstract getModelForTier(tier: ConfidenceTier): string;

  /**
   * Get cost per token for a model
   * @param model Model identifier
   */
  abstract getCostPerToken(model: string): TokenCost;

  /**
   * Get available models
   */
  abstract getAvailableModels(): ModelInfo[];

  /**
   * Validate API key
   */
  abstract validateApiKey(): Promise<boolean>;

  /**
   * Execute with retry logic
   * @param fn Function to execute
   * @param retries Number of retries
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    retries: number = this.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Acquire rate limit token
        await this.rateLimiter.acquire();

        // Execute with circuit breaker
        return await this.circuitBreaker.execute(fn);
      } catch (error) {
        lastError = error as Error;

        // Don't retry if circuit is open
        if (error instanceof Error && error.name === 'CircuitOpenError') {
          throw error;
        }

        // Check if error is retryable
        if (!this.isRetryableError(error)) {
          throw error;
        }

        // Wait before retry with exponential backoff
        if (attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error('Unknown error during retry');
  }

  /**
   * Check if an error is retryable
   */
  protected isRetryableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Retry on rate limits and transient errors
      return (
        message.includes('rate limit') ||
        message.includes('timeout') ||
        message.includes('overloaded') ||
        message.includes('503') ||
        message.includes('529')
      );
    }
    return false;
  }

  /**
   * Convert error to ProviderError
   */
  protected toProviderError(error: unknown): ProviderError {
    if (error instanceof Error) {
      const isRetryable = this.isRetryableError(error);
      return {
        code: this.extractErrorCode(error),
        message: error.message,
        retryable: isRetryable
      };
    }
    return {
      code: 'UNKNOWN_ERROR',
      message: String(error),
      retryable: false
    };
  }

  /**
   * Extract error code from error
   */
  protected extractErrorCode(error: Error): string {
    const message = error.message.toLowerCase();
    if (message.includes('rate limit')) return 'RATE_LIMITED';
    if (message.includes('unauthorized') || message.includes('401'))
      return 'UNAUTHORIZED';
    if (message.includes('forbidden') || message.includes('403'))
      return 'FORBIDDEN';
    if (message.includes('not found') || message.includes('404'))
      return 'NOT_FOUND';
    if (message.includes('timeout')) return 'TIMEOUT';
    if (message.includes('overloaded') || message.includes('529'))
      return 'OVERLOADED';
    return 'API_ERROR';
  }

  /**
   * Sleep helper
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Stop the provider and clean up resources
   */
  stop(): void {
    this.rateLimiter.stop();
  }
}
