/**
 * Confidence Calculator (EXT-005)
 * Routes tasks to appropriate agents based on confidence scoring
 */

export interface Task {
  id: string;
  description: string;
  type?: string;
  files?: string[];
  context?: TaskContext;
  metadata?: Record<string, unknown>;
}

export interface TaskContext {
  codebaseSize?: 'small' | 'medium' | 'large';
  hasTests?: boolean;
  hasDocs?: boolean;
  language?: string;
  framework?: string;
  dependencies?: string[];
}

export interface ConfidenceResult {
  overall: number;
  tier: ConfidenceTier;
  breakdown: ConfidenceBreakdown;
  recommendations: string[];
}

export interface ConfidenceBreakdown {
  requirementClarity: number;
  technicalComplexity: number;
  historicalSuccess: number;
  scopeSize: number;
}

export enum ConfidenceTier {
  TIER_1 = 'TIER_1',  // >= 0.90: Auto-execute with haiku
  TIER_2 = 'TIER_2',  // 0.60-0.90: Post-validation with sonnet
  TIER_3 = 'TIER_3',  // 0.30-0.60: Full review with sonnet
  TIER_4 = 'TIER_4',  // < 0.30: Notify user, use opus
}

export interface TierConfig {
  tier: ConfidenceTier;
  threshold: number;
  model: 'haiku' | 'sonnet' | 'opus';
  autoExecute: boolean;
  requiresValidation: boolean;
  requiresReview: boolean;
  notifyUser: boolean;
}

export const TIER_CONFIGS: TierConfig[] = [
  {
    tier: ConfidenceTier.TIER_1,
    threshold: 0.90,
    model: 'haiku',
    autoExecute: true,
    requiresValidation: false,
    requiresReview: false,
    notifyUser: false,
  },
  {
    tier: ConfidenceTier.TIER_2,
    threshold: 0.60,
    model: 'sonnet',
    autoExecute: true,
    requiresValidation: true,
    requiresReview: false,
    notifyUser: false,
  },
  {
    tier: ConfidenceTier.TIER_3,
    threshold: 0.30,
    model: 'sonnet',
    autoExecute: false,
    requiresValidation: true,
    requiresReview: true,
    notifyUser: false,
  },
  {
    tier: ConfidenceTier.TIER_4,
    threshold: 0,
    model: 'opus',
    autoExecute: false,
    requiresValidation: true,
    requiresReview: true,
    notifyUser: true,
  },
];

// Weights from PRD
const WEIGHTS = {
  requirementClarity: 0.30,
  technicalComplexity: 0.25,
  historicalSuccess: 0.25,
  scopeSize: 0.20,
};

// Historical success rates by task type (can be updated dynamically)
const DEFAULT_HISTORICAL_SUCCESS: Record<string, number> = {
  'bug-fix': 0.85,
  'feature': 0.70,
  'refactor': 0.80,
  'test': 0.90,
  'documentation': 0.95,
  'configuration': 0.85,
  'migration': 0.60,
  'security': 0.65,
  'performance': 0.70,
  'unknown': 0.50,
};

// Complexity indicators
const HIGH_COMPLEXITY_PATTERNS = [
  /\b(async|await|concurrent|parallel|distributed)\b/i,
  /\b(database|migration|schema)\b/i,
  /\b(security|auth|encrypt|credential)\b/i,
  /\b(architecture|refactor|redesign)\b/i,
  /\b(api|endpoint|integration)\b/i,
  /\b(performance|optimize|scale)\b/i,
];

const LOW_COMPLEXITY_PATTERNS = [
  /\b(typo|comment|format|style)\b/i,
  /\b(rename|move|copy)\b/i,
  /\b(log|print|debug)\b/i,
  /\b(readme|doc|comment)\b/i,
  /\b(config|setting|option)\b/i,
];

export class ConfidenceCalculator {
  private historicalSuccess: Map<string, number>;
  private taskHistory: Map<string, { success: number; total: number }>;

  constructor() {
    this.historicalSuccess = new Map(Object.entries(DEFAULT_HISTORICAL_SUCCESS));
    this.taskHistory = new Map();
  }

  /**
   * Calculate overall confidence for a task
   */
  calculate(task: Task): ConfidenceResult {
    const breakdown: ConfidenceBreakdown = {
      requirementClarity: this.analyzeRequirementClarity(task),
      technicalComplexity: this.assessTechnicalComplexity(task),
      historicalSuccess: this.getHistoricalSuccess(task.type || 'unknown'),
      scopeSize: this.evaluateScopeSize(task),
    };

    const overall =
      breakdown.requirementClarity * WEIGHTS.requirementClarity +
      breakdown.technicalComplexity * WEIGHTS.technicalComplexity +
      breakdown.historicalSuccess * WEIGHTS.historicalSuccess +
      breakdown.scopeSize * WEIGHTS.scopeSize;

    const tier = this.getTier(overall);
    const recommendations = this.generateRecommendations(breakdown, tier);

    return {
      overall,
      tier,
      breakdown,
      recommendations,
    };
  }

  /**
   * Get tier based on confidence score
   */
  getTier(confidence: number): ConfidenceTier {
    for (const config of TIER_CONFIGS) {
      if (confidence >= config.threshold) {
        return config.tier;
      }
    }
    return ConfidenceTier.TIER_4;
  }

  /**
   * Get configuration for a tier
   */
  getTierConfig(tier: ConfidenceTier): TierConfig {
    return TIER_CONFIGS.find(c => c.tier === tier) || TIER_CONFIGS[TIER_CONFIGS.length - 1];
  }

  /**
   * Get recommended model for confidence level
   */
  getRecommendedModel(confidence: number): 'haiku' | 'sonnet' | 'opus' {
    const tier = this.getTier(confidence);
    return this.getTierConfig(tier).model;
  }

  /**
   * Analyze requirement clarity based on task description
   */
  private analyzeRequirementClarity(task: Task): number {
    const description = task.description || '';
    let score = 0.5; // Base score

    // Check for specific, measurable requirements
    const specificPatterns = [
      /\b(should|must|will|shall)\b/i,
      /\b(when|if|then|given)\b/i,
      /\b(input|output|return|result)\b/i,
      /\b(file|function|class|method|variable)\b/i,
    ];

    const ambiguousPatterns = [
      /\b(maybe|might|could|possibly)\b/i,
      /\b(something|somehow|somewhere)\b/i,
      /\b(etc|etc\.|and so on)\b/i,
      /\b(fix it|make it work|improve)\b/i,
    ];

    // Boost for specific patterns
    for (const pattern of specificPatterns) {
      if (pattern.test(description)) {
        score += 0.08;
      }
    }

    // Penalty for ambiguous patterns
    for (const pattern of ambiguousPatterns) {
      if (pattern.test(description)) {
        score -= 0.10;
      }
    }

    // Boost for file references
    if (task.files && task.files.length > 0) {
      score += 0.15;
    }

    // Boost for longer, more detailed descriptions
    const wordCount = description.split(/\s+/).length;
    if (wordCount > 20) score += 0.10;
    if (wordCount > 50) score += 0.05;
    if (wordCount < 5) score -= 0.15;

    // Boost for context
    if (task.context) {
      if (task.context.hasTests) score += 0.05;
      if (task.context.hasDocs) score += 0.05;
    }

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Assess technical complexity of the task
   * Returns INVERTED score: higher score = lower complexity = easier task
   */
  private assessTechnicalComplexity(task: Task): number {
    const description = task.description || '';
    let complexityScore = 0; // Lower is simpler

    // Check high complexity patterns
    for (const pattern of HIGH_COMPLEXITY_PATTERNS) {
      if (pattern.test(description)) {
        complexityScore += 0.15;
      }
    }

    // Check low complexity patterns
    for (const pattern of LOW_COMPLEXITY_PATTERNS) {
      if (pattern.test(description)) {
        complexityScore -= 0.10;
      }
    }

    // Consider file count
    if (task.files) {
      const fileCount = task.files.length;
      if (fileCount > 10) complexityScore += 0.20;
      else if (fileCount > 5) complexityScore += 0.10;
      else if (fileCount === 1) complexityScore -= 0.10;
    }

    // Consider codebase size
    if (task.context?.codebaseSize === 'large') {
      complexityScore += 0.15;
    } else if (task.context?.codebaseSize === 'small') {
      complexityScore -= 0.10;
    }

    // Dependency complexity
    if (task.context?.dependencies && task.context.dependencies.length > 10) {
      complexityScore += 0.10;
    }

    // Invert: return 1 - complexity (so simpler tasks get higher scores)
    return Math.max(0, Math.min(1, 1 - complexityScore));
  }

  /**
   * Get historical success rate for task type
   */
  private getHistoricalSuccess(taskType: string): number {
    // Check custom history first
    const history = this.taskHistory.get(taskType);
    if (history && history.total >= 5) {
      return history.success / history.total;
    }

    // Fall back to defaults
    return this.historicalSuccess.get(taskType) || this.historicalSuccess.get('unknown') || 0.5;
  }

  /**
   * Evaluate scope size of the task
   * Returns INVERTED score: higher score = smaller scope = easier task
   */
  private evaluateScopeSize(task: Task): number {
    let scopeScore = 0; // Lower is smaller scope

    const description = task.description || '';
    const wordCount = description.split(/\s+/).length;

    // Check for scope indicators
    const largeScope = [
      /\b(entire|all|every|complete|full)\b/i,
      /\b(system|application|project|codebase)\b/i,
      /\b(redesign|rewrite|overhaul)\b/i,
    ];

    const smallScope = [
      /\b(single|one|specific|particular)\b/i,
      /\b(line|function|method|variable)\b/i,
      /\b(typo|comment|minor)\b/i,
    ];

    for (const pattern of largeScope) {
      if (pattern.test(description)) {
        scopeScore += 0.20;
      }
    }

    for (const pattern of smallScope) {
      if (pattern.test(description)) {
        scopeScore -= 0.15;
      }
    }

    // File count impact
    if (task.files) {
      const fileCount = task.files.length;
      if (fileCount > 20) scopeScore += 0.30;
      else if (fileCount > 10) scopeScore += 0.20;
      else if (fileCount > 5) scopeScore += 0.10;
      else if (fileCount === 1) scopeScore -= 0.15;
    }

    // Description length can indicate scope
    if (wordCount > 100) scopeScore += 0.15;
    else if (wordCount < 10) scopeScore -= 0.10;

    // Invert: smaller scope = higher confidence
    return Math.max(0, Math.min(1, 1 - scopeScore));
  }

  /**
   * Generate recommendations based on confidence breakdown
   */
  private generateRecommendations(
    breakdown: ConfidenceBreakdown,
    tier: ConfidenceTier
  ): string[] {
    const recommendations: string[] = [];

    if (breakdown.requirementClarity < 0.5) {
      recommendations.push('Consider adding more specific requirements or acceptance criteria');
    }

    if (breakdown.technicalComplexity < 0.4) {
      recommendations.push('Task involves complex technical areas - consider breaking into subtasks');
    }

    if (breakdown.historicalSuccess < 0.6) {
      recommendations.push('Similar tasks have had mixed success - additional review recommended');
    }

    if (breakdown.scopeSize < 0.4) {
      recommendations.push('Large scope detected - consider decomposing into smaller tasks');
    }

    // Tier-specific recommendations
    switch (tier) {
      case ConfidenceTier.TIER_1:
        recommendations.push('Task is well-suited for automated execution');
        break;
      case ConfidenceTier.TIER_2:
        recommendations.push('Recommend post-execution validation');
        break;
      case ConfidenceTier.TIER_3:
        recommendations.push('Full review recommended before and after execution');
        break;
      case ConfidenceTier.TIER_4:
        recommendations.push('Human oversight strongly recommended for this task');
        break;
    }

    return recommendations;
  }

  /**
   * Record task outcome for improving future predictions
   */
  recordOutcome(taskType: string, success: boolean): void {
    const history = this.taskHistory.get(taskType) || { success: 0, total: 0 };
    history.total += 1;
    if (success) {
      history.success += 1;
    }
    this.taskHistory.set(taskType, history);
  }

  /**
   * Update default historical success rate
   */
  updateHistoricalRate(taskType: string, rate: number): void {
    this.historicalSuccess.set(taskType, Math.max(0, Math.min(1, rate)));
  }

  /**
   * Get all tier configurations
   */
  getAllTierConfigs(): TierConfig[] {
    return [...TIER_CONFIGS];
  }

  /**
   * Check if task should auto-execute based on confidence
   */
  shouldAutoExecute(task: Task): boolean {
    const result = this.calculate(task);
    return this.getTierConfig(result.tier).autoExecute;
  }

  /**
   * Check if task requires user notification
   */
  requiresUserNotification(task: Task): boolean {
    const result = this.calculate(task);
    return this.getTierConfig(result.tier).notifyUser;
  }
}
