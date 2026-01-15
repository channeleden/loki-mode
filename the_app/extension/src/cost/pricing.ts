/**
 * Provider pricing tables for AI model cost calculation
 * Prices are per 1 million tokens
 */

export interface ModelPricing {
  input: number;   // Cost per 1M input tokens
  output: number;  // Cost per 1M output tokens
}

export interface ProviderPricing {
  [model: string]: ModelPricing;
}

export const PRICING: Record<string, ProviderPricing> = {
  anthropic: {
    'claude-opus-4-5': { input: 15.0, output: 75.0 },
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-haiku-3-5': { input: 0.25, output: 1.25 },
    // Legacy models
    'claude-3-opus': { input: 15.0, output: 75.0 },
    'claude-3-sonnet': { input: 3.0, output: 15.0 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
  },
  openai: {
    'gpt-4o': { input: 5.0, output: 15.0 },
    'gpt-4-turbo': { input: 10.0, output: 30.0 },
    'gpt-4': { input: 30.0, output: 60.0 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    'o1': { input: 15.0, output: 60.0 },
    'o1-mini': { input: 3.0, output: 12.0 },
  },
  google: {
    'gemini-2.0-flash': { input: 0.075, output: 0.30 },
    'gemini-2.0-pro': { input: 1.25, output: 5.0 },
    'gemini-1.5-pro': { input: 1.25, output: 5.0 },
    'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  },
  mistral: {
    'mistral-large': { input: 2.0, output: 6.0 },
    'mistral-medium': { input: 2.7, output: 8.1 },
    'mistral-small': { input: 0.2, output: 0.6 },
  },
};

/**
 * Model alias mapping for normalized model identification
 */
const MODEL_ALIASES: Record<string, { provider: string; model: string }> = {
  'opus': { provider: 'anthropic', model: 'claude-opus-4-5' },
  'sonnet': { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  'haiku': { provider: 'anthropic', model: 'claude-haiku-3-5' },
  'gpt4': { provider: 'openai', model: 'gpt-4o' },
  'gemini': { provider: 'google', model: 'gemini-2.0-pro' },
};

/**
 * Resolve a model string to its provider and canonical model name
 */
export function resolveModel(modelString: string): { provider: string; model: string } | null {
  const normalized = modelString.toLowerCase().trim();

  // Check aliases first
  if (MODEL_ALIASES[normalized]) {
    return MODEL_ALIASES[normalized];
  }

  // Try to find in pricing tables
  for (const [provider, models] of Object.entries(PRICING)) {
    if (models[normalized] || models[modelString]) {
      return { provider, model: modelString };
    }
  }

  // Try partial matching
  for (const [provider, models] of Object.entries(PRICING)) {
    for (const model of Object.keys(models)) {
      if (model.includes(normalized) || normalized.includes(model)) {
        return { provider, model };
      }
    }
  }

  return null;
}

/**
 * Get pricing for a specific model
 */
export function getModelPricing(model: string, provider?: string): ModelPricing | null {
  if (provider && PRICING[provider]?.[model]) {
    return PRICING[provider][model];
  }

  const resolved = resolveModel(model);
  if (resolved && PRICING[resolved.provider]?.[resolved.model]) {
    return PRICING[resolved.provider][resolved.model];
  }

  return null;
}

/**
 * Calculate cost for a request given model and token counts
 * @param model - Model identifier (can be alias or full name)
 * @param inputTokens - Number of input tokens
 * @param outputTokens - Number of output tokens
 * @param provider - Optional provider hint
 * @returns Cost in USD, or 0 if model not found
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  provider?: string
): number {
  const pricing = getModelPricing(model, provider);

  if (!pricing) {
    console.warn(`Unknown model: ${model}. Cost calculation returning 0.`);
    return 0;
  }

  // Convert from per-million to actual cost
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

/**
 * Estimate cost for a given number of tokens at a specific model tier
 */
export function estimateCostRange(
  estimatedInputTokens: number,
  estimatedOutputTokens: number,
  modelTier: 'fast' | 'balanced' | 'powerful' = 'balanced'
): { min: number; max: number; typical: number } {
  const tierModels = {
    fast: ['claude-haiku-3-5', 'gpt-3.5-turbo', 'gemini-2.0-flash'],
    balanced: ['claude-sonnet-4-5', 'gpt-4o', 'gemini-2.0-pro'],
    powerful: ['claude-opus-4-5', 'gpt-4-turbo', 'o1'],
  };

  const models = tierModels[modelTier];
  const costs = models.map(model => calculateCost(model, estimatedInputTokens, estimatedOutputTokens));

  return {
    min: Math.min(...costs),
    max: Math.max(...costs),
    typical: costs.reduce((a, b) => a + b, 0) / costs.length,
  };
}

/**
 * Format cost as a human-readable string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${(cost * 100).toFixed(2)}c`;
  }
  return `$${cost.toFixed(4)}`;
}

/**
 * Get all available providers
 */
export function getProviders(): string[] {
  return Object.keys(PRICING);
}

/**
 * Get all models for a provider
 */
export function getModelsForProvider(provider: string): string[] {
  return Object.keys(PRICING[provider] || {});
}
