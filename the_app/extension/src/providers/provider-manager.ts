/**
 * Provider manager for handling multiple AI providers with fallback
 */

import { BaseProvider } from './base-provider';
import { AnthropicProvider } from './anthropic-provider';
import { OpenAIProvider } from './openai-provider';
import { CircuitBreaker } from './circuit-breaker';
import {
  Message,
  CompletionOptions,
  StreamChunk,
  ProviderConfig,
  ProviderStatus,
  ConfidenceTier
} from './types';

export interface ProviderManagerConfig {
  providers: {
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
  };
  defaultProvider?: string;
  fallbackOrder?: string[];
  enableFallback?: boolean;
}

export class ProviderManager {
  private providers: Map<string, BaseProvider> = new Map();
  private fallbackOrder: string[];
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private defaultProvider: string;
  private enableFallback: boolean;

  constructor(config: ProviderManagerConfig) {
    this.fallbackOrder = config.fallbackOrder ?? ['anthropic', 'openai'];
    this.enableFallback = config.enableFallback ?? true;
    this.defaultProvider = config.defaultProvider ?? 'anthropic';

    // Initialize providers
    if (config.providers.anthropic) {
      this.addProvider('anthropic', new AnthropicProvider(config.providers.anthropic));
    }

    if (config.providers.openai) {
      this.addProvider('openai', new OpenAIProvider(config.providers.openai));
    }
  }

  /**
   * Add a provider to the manager
   */
  addProvider(name: string, provider: BaseProvider): void {
    this.providers.set(name, provider);

    // Create circuit breaker for the provider
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 30000,
      successThreshold: 2
    });

    circuitBreaker.onStateChange = (prev, next) => {
      console.log(`Provider ${name} circuit: ${prev} -> ${next}`);
    };

    this.circuitBreakers.set(name, circuitBreaker);
  }

  /**
   * Remove a provider from the manager
   */
  removeProvider(name: string): void {
    const provider = this.providers.get(name);
    if (provider) {
      provider.stop();
      this.providers.delete(name);
      this.circuitBreakers.delete(name);
    }
  }

  /**
   * Get a specific provider
   */
  getProvider(name: string): BaseProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get available provider, respecting circuit breakers and fallback order
   */
  async getAvailableProvider(preferred?: string): Promise<BaseProvider> {
    // Try preferred provider first
    if (preferred) {
      const provider = this.providers.get(preferred);
      const circuitBreaker = this.circuitBreakers.get(preferred);

      if (provider && circuitBreaker && !circuitBreaker.isOpen()) {
        return provider;
      }
    }

    // Try default provider
    const defaultProv = this.providers.get(this.defaultProvider);
    const defaultCb = this.circuitBreakers.get(this.defaultProvider);

    if (defaultProv && defaultCb && !defaultCb.isOpen()) {
      return defaultProv;
    }

    // Fallback through providers
    if (this.enableFallback) {
      for (const name of this.fallbackOrder) {
        const provider = this.providers.get(name);
        const circuitBreaker = this.circuitBreakers.get(name);

        if (provider && circuitBreaker && !circuitBreaker.isOpen()) {
          return provider;
        }
      }
    }

    throw new Error('No available providers');
  }

  /**
   * Complete a conversation with automatic fallback
   */
  async *complete(
    messages: Message[],
    options: CompletionOptions = {}
  ): AsyncGenerator<StreamChunk> {
    const preferredProvider = options.model?.includes('claude')
      ? 'anthropic'
      : options.model?.includes('gpt')
        ? 'openai'
        : undefined;

    let lastError: Error | null = null;
    const triedProviders: string[] = [];

    // Build provider order
    const providerOrder = this.buildProviderOrder(preferredProvider);

    for (const providerName of providerOrder) {
      if (triedProviders.includes(providerName)) {
        continue;
      }

      const provider = this.providers.get(providerName);
      const circuitBreaker = this.circuitBreakers.get(providerName);

      if (!provider || !circuitBreaker || circuitBreaker.isOpen()) {
        continue;
      }

      triedProviders.push(providerName);

      try {
        // Execute with circuit breaker
        const completionOptions = { ...options };

        // If switching providers, let the new provider choose model for tier
        if (preferredProvider && providerName !== preferredProvider) {
          delete completionOptions.model;
        }

        for await (const chunk of provider.complete(messages, completionOptions)) {
          if (chunk.type === 'error' && chunk.error?.retryable) {
            lastError = new Error(chunk.error.message);
            circuitBreaker.recordFailure();
            break;
          }
          yield chunk;
        }

        // If we got here without breaking, success
        circuitBreaker.recordSuccess();
        return;
      } catch (error) {
        lastError = error as Error;
        circuitBreaker.recordFailure();

        if (!this.enableFallback) {
          throw error;
        }
        // Continue to next provider
      }
    }

    // All providers failed
    yield {
      type: 'error',
      error: {
        code: 'ALL_PROVIDERS_FAILED',
        message: lastError?.message ?? 'All providers failed',
        retryable: false
      }
    };
  }

  /**
   * Build provider order based on preference
   */
  private buildProviderOrder(preferred?: string): string[] {
    const order: string[] = [];

    // Preferred provider first
    if (preferred && this.providers.has(preferred)) {
      order.push(preferred);
    }

    // Default provider second
    if (
      this.defaultProvider !== preferred &&
      this.providers.has(this.defaultProvider)
    ) {
      order.push(this.defaultProvider);
    }

    // Then fallback order
    for (const name of this.fallbackOrder) {
      if (!order.includes(name) && this.providers.has(name)) {
        order.push(name);
      }
    }

    return order;
  }

  /**
   * Handle provider failure
   */
  handleFailure(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.recordFailure();
    }
  }

  /**
   * Handle provider success
   */
  handleSuccess(providerName: string): void {
    const circuitBreaker = this.circuitBreakers.get(providerName);
    if (circuitBreaker) {
      circuitBreaker.recordSuccess();
    }
  }

  /**
   * Get status of all providers
   */
  getStatus(): ProviderStatus[] {
    const statuses: ProviderStatus[] = [];

    for (const [name, provider] of this.providers) {
      const circuitBreaker = this.circuitBreakers.get(name);
      const stats = circuitBreaker?.getStats();

      statuses.push({
        name,
        available: provider.isAvailable() && !circuitBreaker?.isOpen(),
        circuitState: circuitBreaker?.getState() ?? 'CLOSED',
        lastSuccessTime: stats?.lastSuccessTime ?? undefined,
        lastError: stats?.lastFailureTime
          ? {
              code: 'UNKNOWN',
              message: 'Provider experienced failures',
              retryable: true
            }
          : undefined
      });
    }

    return statuses;
  }

  /**
   * Get model for confidence tier from any available provider
   */
  getModelForTier(tier: ConfidenceTier, providerName?: string): string {
    if (providerName) {
      const provider = this.providers.get(providerName);
      if (provider) {
        return provider.getModelForTier(tier);
      }
    }

    // Use default provider
    const defaultProv = this.providers.get(this.defaultProvider);
    if (defaultProv) {
      return defaultProv.getModelForTier(tier);
    }

    // Fallback to any available provider
    for (const provider of this.providers.values()) {
      return provider.getModelForTier(tier);
    }

    throw new Error('No providers available for model selection');
  }

  /**
   * Check if any provider is available
   */
  hasAvailableProvider(): boolean {
    for (const [name, provider] of this.providers) {
      const circuitBreaker = this.circuitBreakers.get(name);
      if (provider.isAvailable() && !circuitBreaker?.isOpen()) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of available provider names
   */
  getAvailableProviderNames(): string[] {
    const available: string[] = [];

    for (const [name, provider] of this.providers) {
      const circuitBreaker = this.circuitBreakers.get(name);
      if (provider.isAvailable() && !circuitBreaker?.isOpen()) {
        available.push(name);
      }
    }

    return available;
  }

  /**
   * Reset all circuit breakers
   */
  resetCircuitBreakers(): void {
    for (const cb of this.circuitBreakers.values()) {
      cb.reset();
    }
  }

  /**
   * Stop all providers and clean up
   */
  stop(): void {
    for (const provider of this.providers.values()) {
      provider.stop();
    }
    this.providers.clear();
    this.circuitBreakers.clear();
  }
}
