/**
 * Autonomi Extension - RARV Cycle Implementation
 *
 * The Reason-Act-Reflect-Verify execution loop that forms the core
 * of the autonomous development workflow.
 *
 * Version: 1.0.0
 */

import {
  Task,
  TaskResult,
  TaskError,
  TaskMetrics,
  RARVPhase,
  RARVEvent,
  RARVEventType,
  EventHandler,
  ReasonResult,
  ActResult,
  VerifyResult,
  ExecutionPlan,
  PlanStep,
  Artifact,
  AgentType,
  Provider,
  Message,
  TokenUsage,
  ConfidenceResult,
  ConfidenceFactors,
  ConfidenceTier,
  ModelTier,
  QualityGateResult,
  QualityIssue,
  Memory,
  MemoryType,
} from '../types';

// ============================================================================
// RARV Cycle Configuration
// ============================================================================

interface RARVConfig {
  maxRetries: number;
  retryDelayMs: number;
  reasoningModel: ModelTier;
  executionModel: ModelTier;
  verificationModel: ModelTier;
  enableLearning: boolean;
  enableStreaming: boolean;
}

const DEFAULT_CONFIG: RARVConfig = {
  maxRetries: 3,
  retryDelayMs: 1000,
  reasoningModel: 'sonnet',
  executionModel: 'sonnet',
  verificationModel: 'haiku',
  enableLearning: true,
  enableStreaming: true,
};

// ============================================================================
// RARV Cycle Class
// ============================================================================

export class RARVCycle {
  private currentPhase: RARVPhase = 'idle';
  private task: Task | null = null;
  private learnings: string[] = [];
  private retryCount: number = 0;
  private config: RARVConfig;
  private provider: Provider;
  private eventHandlers: Set<EventHandler> = new Set();
  private phaseTimings: Record<RARVPhase, number> = {
    idle: 0,
    reason: 0,
    act: 0,
    reflect: 0,
    verify: 0,
  };
  private totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  private artifacts: Artifact[] = [];
  private executionPlan: ExecutionPlan | null = null;
  private selectedAgent: AgentType | null = null;
  private startTime: number = 0;
  private memoryStore: MemoryStore | null = null;

  constructor(provider: Provider, config: Partial<RARVConfig> = {}) {
    this.provider = provider;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Execute the full RARV cycle for a given task
   */
  async execute(task: Task): Promise<TaskResult> {
    this.task = task;
    this.retryCount = 0;
    this.learnings = [];
    this.artifacts = [];
    this.startTime = Date.now();
    this.resetTokens();
    this.resetPhaseTimings();

    this.emitEvent('task-started', { task });

    try {
      return await this.runCycle();
    } catch (error) {
      const taskError = this.createTaskError(error, this.currentPhase);
      this.emitEvent('task-failed', { error: taskError });

      return this.createFailureResult([taskError]);
    } finally {
      this.currentPhase = 'idle';
      this.task = null;
    }
  }

  /**
   * Subscribe to RARV events
   */
  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Get current phase
   */
  getPhase(): RARVPhase {
    return this.currentPhase;
  }

  /**
   * Get current task
   */
  getTask(): Task | null {
    return this.task;
  }

  /**
   * Set memory store for learning persistence
   */
  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
  }

  // ==========================================================================
  // Core Cycle Implementation
  // ==========================================================================

  private async runCycle(): Promise<TaskResult> {
    while (this.retryCount <= this.config.maxRetries) {
      try {
        // Phase 1: REASON - Analyze task, read state, plan approach
        const reasonResult = await this.reason();

        // Phase 2: ACT - Execute with streaming output
        const actResult = await this.act(reasonResult);

        // Phase 3: REFLECT - Capture learnings, update memory
        await this.reflect(actResult);

        // Phase 4: VERIFY - Run automated tests, validate output
        const verifyResult = await this.verify(actResult);

        if (verifyResult.passed) {
          this.emitEvent('task-completed', {
            verifyResult,
            retryCount: this.retryCount
          });

          return this.createSuccessResult(actResult, verifyResult);
        }

        // Verification failed - retry with updated approach
        this.retryCount++;
        if (this.retryCount <= this.config.maxRetries) {
          this.learnings.push(...this.extractLearningsFromFailure(verifyResult));
          this.emitEvent('retry-initiated', {
            attempt: this.retryCount,
            reason: verifyResult.blockers
          });
          await this.delay(this.config.retryDelayMs * this.retryCount);
        }
      } catch (error) {
        if (this.isRecoverableError(error)) {
          this.retryCount++;
          if (this.retryCount <= this.config.maxRetries) {
            await this.delay(this.config.retryDelayMs * this.retryCount);
            continue;
          }
        }
        throw error;
      }
    }

    // Max retries exceeded
    const maxRetriesError: TaskError = {
      code: 'MAX_RETRIES_EXCEEDED',
      message: `Task failed after ${this.config.maxRetries} retries`,
      phase: this.currentPhase,
      recoverable: false,
    };

    return this.createFailureResult([maxRetriesError]);
  }

  // ==========================================================================
  // Phase 1: REASON
  // ==========================================================================

  private async reason(): Promise<ReasonResult> {
    this.setPhase('reason');
    const phaseStart = Date.now();

    if (!this.task) {
      throw new Error('No task set for reasoning phase');
    }

    // Calculate confidence for the task
    const confidenceResult = await this.calculateConfidence(this.task);

    // Select appropriate agent based on task type and confidence
    const selectedAgent = this.selectAgent(this.task, confidenceResult);
    this.selectedAgent = selectedAgent;

    // Generate execution plan
    const plan = await this.generatePlan(this.task, selectedAgent, confidenceResult);
    this.executionPlan = plan;

    // Build reasoning result
    const result: ReasonResult = {
      plan,
      selectedAgent,
      confidence: confidenceResult.score,
      reasoning: this.buildReasoningExplanation(this.task, plan, confidenceResult),
      estimatedCost: plan.estimatedCost,
      warnings: this.identifyWarnings(this.task, plan),
    };

    this.phaseTimings.reason = Date.now() - phaseStart;
    this.emitEvent('phase-completed', { phase: 'reason', result });

    return result;
  }

  private async calculateConfidence(task: Task): Promise<ConfidenceResult> {
    const factors: ConfidenceFactors = {
      requirementClarity: this.assessRequirementClarity(task),
      technicalComplexity: this.assessTechnicalComplexity(task),
      historicalSuccess: await this.getHistoricalSuccess(task),
      scopeSize: this.assessScopeSize(task),
    };

    // Weighted calculation
    const score =
      factors.requirementClarity * 0.30 +
      factors.technicalComplexity * 0.25 +
      factors.historicalSuccess * 0.25 +
      factors.scopeSize * 0.20;

    const tier = this.determineTier(score);
    const recommendedModel = this.getRecommendedModel(tier);
    const requiresApproval = tier >= 3 || score < 0.60;

    return {
      score,
      tier,
      factors,
      recommendedModel,
      requiresApproval,
    };
  }

  private assessRequirementClarity(task: Task): number {
    const description = task.description.toLowerCase();
    let score = 0.5; // Base score

    // Positive indicators
    if (description.length > 50) score += 0.1;
    if (task.context.files.length > 0) score += 0.15;
    if (task.context.language) score += 0.1;
    if (description.includes('should') || description.includes('must')) score += 0.05;

    // Negative indicators
    if (description.includes('maybe') || description.includes('possibly')) score -= 0.1;
    if (description.includes('?')) score -= 0.05;
    if (description.length < 20) score -= 0.15;

    return Math.max(0, Math.min(1, score));
  }

  private assessTechnicalComplexity(task: Task): number {
    // Inverse score - lower complexity = higher confidence
    const complexityIndicators = [
      'migration', 'architecture', 'refactor', 'security',
      'performance', 'database', 'integration', 'api',
    ];

    let complexityScore = 0;
    const description = task.description.toLowerCase();

    for (const indicator of complexityIndicators) {
      if (description.includes(indicator)) {
        complexityScore += 0.15;
      }
    }

    // More files = more complexity
    complexityScore += Math.min(0.3, task.context.files.length * 0.05);

    // Return inverted (high complexity = low confidence factor)
    return Math.max(0, 1 - complexityScore);
  }

  private async getHistoricalSuccess(task: Task): Promise<number> {
    if (!this.memoryStore) {
      return 0.5; // Default when no history available
    }

    try {
      const similarTasks = await this.memoryStore.query({
        type: 'episodic',
        tags: [task.type],
        minConfidence: 0.3,
        limit: 10,
      });

      if (similarTasks.length === 0) {
        return 0.5;
      }

      const avgConfidence = similarTasks.reduce((sum, m) => sum + m.confidence, 0) / similarTasks.length;
      return avgConfidence;
    } catch {
      return 0.5;
    }
  }

  private assessScopeSize(task: Task): number {
    // Smaller scope = higher confidence factor
    const fileCount = task.context.files.length;

    if (fileCount === 0) return 0.8; // Simple task
    if (fileCount <= 2) return 0.7;
    if (fileCount <= 5) return 0.5;
    if (fileCount <= 10) return 0.3;
    return 0.1; // Large scope
  }

  private determineTier(score: number): ConfidenceTier {
    if (score >= 0.90) return 1;
    if (score >= 0.60) return 2;
    if (score >= 0.30) return 3;
    return 4;
  }

  private getRecommendedModel(tier: ConfidenceTier): ModelTier {
    switch (tier) {
      case 1: return 'haiku';
      case 2: return 'sonnet';
      case 3: return 'sonnet';
      case 4: return 'opus';
    }
  }

  private selectAgent(task: Task, confidence: ConfidenceResult): AgentType {
    // Direct mapping for most task types
    const typeToAgent: Record<string, AgentType> = {
      'frontend': 'frontend',
      'backend': 'backend',
      'database': 'database',
      'api': 'api',
      'devops': 'devops',
      'qa': 'qa',
      'code-review': 'code-review',
      'security-review': 'security-review',
      'test-gen': 'test-gen',
      'perf': 'perf',
      'docs': 'docs',
      'refactor': 'refactor',
      'migration': 'migration',
      'architect': 'architect',
      'decomposition': 'decomposition',
    };

    if (task.type in typeToAgent) {
      return typeToAgent[task.type];
    }

    // Infer from description for general tasks
    return this.inferAgentFromDescription(task.description);
  }

  private inferAgentFromDescription(description: string): AgentType {
    const lower = description.toLowerCase();

    // Engineering patterns
    if (lower.match(/react|vue|angular|css|html|component|ui|frontend|style/)) {
      return 'frontend';
    }
    if (lower.match(/api|rest|graphql|endpoint|route|controller/)) {
      return 'api';
    }
    if (lower.match(/database|sql|schema|migration|query|table/)) {
      return 'database';
    }
    if (lower.match(/docker|kubernetes|k8s|ci|cd|deploy|pipeline|infra/)) {
      return 'devops';
    }
    if (lower.match(/test|spec|e2e|integration|unit test/)) {
      return 'qa';
    }
    if (lower.match(/node|python|go|java|server|backend|service/)) {
      return 'backend';
    }

    // Quality patterns
    if (lower.match(/review|code quality|lint|maintainability/)) {
      return 'code-review';
    }
    if (lower.match(/security|vulnerability|owasp|secrets|auth/)) {
      return 'security-review';
    }
    if (lower.match(/performance|optimize|latency|memory|profil/)) {
      return 'perf';
    }
    if (lower.match(/test gen|generate test|coverage/)) {
      return 'test-gen';
    }

    // Support patterns
    if (lower.match(/document|readme|api doc|comment/)) {
      return 'docs';
    }
    if (lower.match(/refactor|clean|modernize|simplif/)) {
      return 'refactor';
    }
    if (lower.match(/migrat|upgrade|version/)) {
      return 'migration';
    }

    // Planning patterns
    if (lower.match(/architect|design|system|structure/)) {
      return 'architect';
    }
    if (lower.match(/break down|decompos|split|subtask/)) {
      return 'decomposition';
    }

    // Default to backend for general tasks
    return 'backend';
  }

  private async generatePlan(
    task: Task,
    agent: AgentType,
    confidence: ConfidenceResult
  ): Promise<ExecutionPlan> {
    const messages: Message[] = [
      {
        role: 'system',
        content: this.getPlanningSystemPrompt(),
      },
      {
        role: 'user',
        content: this.buildPlanningPrompt(task, agent, confidence),
      },
    ];

    const response = await this.provider.generateCompletion({
      model: this.provider.getModel(this.config.reasoningModel),
      messages,
      maxTokens: 2000,
      temperature: 0.3,
    });

    this.addTokens(response.usage);

    return this.parsePlanResponse(response.content, task);
  }

  private getPlanningSystemPrompt(): string {
    return `You are a planning agent for an autonomous development system.
Your task is to create detailed execution plans for development tasks.

Output a JSON plan with this structure:
{
  "steps": [
    {
      "id": "step_1",
      "description": "Description of step",
      "type": "read|write|execute|verify",
      "target": "file path or command (optional)",
      "dependencies": ["step_ids this depends on"]
    }
  ],
  "estimatedDuration": <minutes as number>,
  "estimatedCost": <USD as number>,
  "affectedFiles": ["list of files to modify"],
  "risks": ["potential risks"]
}

Be thorough but concise. Focus on actionable steps.`;
  }

  private buildPlanningPrompt(
    task: Task,
    agent: AgentType,
    confidence: ConfidenceResult
  ): string {
    return `Task: ${task.description}
Type: ${task.type}
Agent: ${agent}
Confidence: ${confidence.score.toFixed(2)} (Tier ${confidence.tier})

Context:
- Files: ${task.context.files.join(', ') || 'none specified'}
- Workspace: ${task.context.workspaceRoot}
- Language: ${task.context.language || 'unknown'}
- Framework: ${task.context.framework || 'unknown'}

Previous learnings from similar tasks:
${this.learnings.length > 0 ? this.learnings.join('\n') : 'none'}

Create a detailed execution plan for this task.`;
  }

  private parsePlanResponse(content: string, task: Task): ExecutionPlan {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          steps: parsed.steps || [],
          estimatedDuration: parsed.estimatedDuration || 5,
          estimatedCost: parsed.estimatedCost || 0.01,
          affectedFiles: parsed.affectedFiles || task.context.files,
          risks: parsed.risks || [],
        };
      }
    } catch {
      // Fallback to default plan
    }

    // Default plan if parsing fails
    return {
      steps: [
        {
          id: 'step_1',
          description: 'Analyze task requirements',
          type: 'read',
          dependencies: [],
        },
        {
          id: 'step_2',
          description: 'Implement solution',
          type: 'write',
          dependencies: ['step_1'],
        },
        {
          id: 'step_3',
          description: 'Verify implementation',
          type: 'verify',
          dependencies: ['step_2'],
        },
      ],
      estimatedDuration: 10,
      estimatedCost: 0.05,
      affectedFiles: task.context.files,
      risks: ['Plan generated from defaults due to parsing failure'],
    };
  }

  private buildReasoningExplanation(
    task: Task,
    plan: ExecutionPlan,
    confidence: ConfidenceResult
  ): string {
    return `Task Analysis:
- Confidence Score: ${confidence.score.toFixed(2)} (Tier ${confidence.tier})
- Requirement Clarity: ${(confidence.factors.requirementClarity * 100).toFixed(0)}%
- Technical Complexity: ${((1 - confidence.factors.technicalComplexity) * 100).toFixed(0)}%
- Historical Success: ${(confidence.factors.historicalSuccess * 100).toFixed(0)}%
- Scope Size: ${(confidence.factors.scopeSize * 100).toFixed(0)}%

Execution Plan:
- ${plan.steps.length} steps identified
- Estimated duration: ${plan.estimatedDuration} minutes
- Estimated cost: $${plan.estimatedCost.toFixed(4)}
- Files affected: ${plan.affectedFiles.length}
- Risks identified: ${plan.risks.length}`;
  }

  private identifyWarnings(task: Task, plan: ExecutionPlan): string[] {
    const warnings: string[] = [];

    if (plan.risks.length > 0) {
      warnings.push(...plan.risks.map(r => `Risk: ${r}`));
    }

    if (plan.estimatedCost > 1.0) {
      warnings.push('High estimated cost - consider breaking into smaller tasks');
    }

    if (plan.affectedFiles.length > 10) {
      warnings.push('Large number of files affected - review plan carefully');
    }

    if (task.description.length < 20) {
      warnings.push('Task description is brief - may need clarification');
    }

    return warnings;
  }

  // ==========================================================================
  // Phase 2: ACT
  // ==========================================================================

  private async act(reasonResult: ReasonResult): Promise<ActResult> {
    this.setPhase('act');
    const phaseStart = Date.now();

    if (!this.task) {
      throw new Error('No task set for act phase');
    }

    const messages: Message[] = [
      {
        role: 'system',
        content: this.getExecutionSystemPrompt(reasonResult.selectedAgent),
      },
      {
        role: 'user',
        content: this.buildExecutionPrompt(this.task, reasonResult),
      },
    ];

    let output = '';
    const artifacts: Artifact[] = [];

    if (this.config.enableStreaming) {
      // Stream execution for real-time output
      for await (const chunk of this.provider.streamCompletion({
        model: this.provider.getModel(this.config.executionModel),
        messages,
        maxTokens: 4000,
        temperature: 0.5,
      })) {
        if (chunk.type === 'text' && chunk.delta) {
          output += chunk.delta;
          this.emitEvent('phase-started', {
            phase: 'act',
            streaming: true,
            chunk: chunk.delta
          });
        }
      }
    } else {
      // Non-streaming execution
      const response = await this.provider.generateCompletion({
        model: this.provider.getModel(this.config.executionModel),
        messages,
        maxTokens: 4000,
        temperature: 0.5,
      });
      output = response.content;
      this.addTokens(response.usage);
    }

    // Extract artifacts from output
    const extractedArtifacts = this.extractArtifacts(output);
    artifacts.push(...extractedArtifacts);
    this.artifacts.push(...extractedArtifacts);

    const result: ActResult = {
      success: output.length > 0,
      output,
      artifacts,
      toolCalls: [],
      tokensUsed: { ...this.totalTokens },
      duration: Date.now() - phaseStart,
    };

    this.phaseTimings.act = Date.now() - phaseStart;
    this.emitEvent('phase-completed', { phase: 'act', result });

    return result;
  }

  private getExecutionSystemPrompt(agent: AgentType): string {
    // Base system prompt - agent-specific prompts will be provided by AgentFactory
    return `You are an expert ${agent} development agent.

Your task is to implement the given plan accurately and completely.

When producing code:
1. Write clean, well-documented code
2. Follow best practices for the language/framework
3. Include error handling
4. Use markdown code blocks with language tags

When producing artifacts:
1. Wrap code in \`\`\`language blocks
2. Specify file paths where code should be written
3. Include explanations for non-obvious decisions

Do not include placeholder code. Every snippet should be complete and functional.`;
  }

  private buildExecutionPrompt(task: Task, reason: ReasonResult): string {
    return `Task: ${task.description}

Execution Plan:
${reason.plan.steps.map((s, i) => `${i + 1}. ${s.description}`).join('\n')}

Confidence: ${reason.confidence.toFixed(2)}
Estimated Cost: $${reason.estimatedCost.toFixed(4)}

Context:
- Workspace: ${task.context.workspaceRoot}
- Language: ${task.context.language || 'detect from files'}
- Framework: ${task.context.framework || 'detect from dependencies'}

${this.learnings.length > 0 ? `
Previous learnings to apply:
${this.learnings.join('\n')}
` : ''}

Execute this plan. Provide complete, working code for each step.`;
  }

  private extractArtifacts(output: string): Artifact[] {
    const artifacts: Artifact[] = [];

    // Extract code blocks
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let index = 0;

    while ((match = codeBlockRegex.exec(output)) !== null) {
      const language = match[1] || 'text';
      const content = match[2].trim();

      artifacts.push({
        id: `artifact_${Date.now()}_${index++}`,
        type: this.inferArtifactType(language, content),
        name: `code_${index}.${this.getFileExtension(language)}`,
        content,
        mimeType: this.getMimeType(language),
      });
    }

    return artifacts;
  }

  private inferArtifactType(language: string, content: string): Artifact['type'] {
    if (language.match(/test|spec/i) || content.includes('describe(') || content.includes('test(')) {
      return 'test';
    }
    if (language.match(/md|markdown/i)) {
      return 'documentation';
    }
    if (language.match(/json|yaml|yml|toml|ini|env/i)) {
      return 'config';
    }
    return 'code';
  }

  private getFileExtension(language: string): string {
    const extensions: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      go: 'go',
      rust: 'rs',
      java: 'java',
      csharp: 'cs',
      cpp: 'cpp',
      c: 'c',
      ruby: 'rb',
      php: 'php',
      swift: 'swift',
      kotlin: 'kt',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      yaml: 'yaml',
      sql: 'sql',
      markdown: 'md',
      shell: 'sh',
      bash: 'sh',
    };
    return extensions[language.toLowerCase()] || 'txt';
  }

  private getMimeType(language: string): string {
    const mimeTypes: Record<string, string> = {
      typescript: 'text/typescript',
      javascript: 'text/javascript',
      python: 'text/x-python',
      json: 'application/json',
      yaml: 'text/yaml',
      html: 'text/html',
      css: 'text/css',
      markdown: 'text/markdown',
    };
    return mimeTypes[language.toLowerCase()] || 'text/plain';
  }

  // ==========================================================================
  // Phase 3: REFLECT
  // ==========================================================================

  private async reflect(result: ActResult): Promise<void> {
    this.setPhase('reflect');
    const phaseStart = Date.now();

    if (!this.task) {
      throw new Error('No task set for reflect phase');
    }

    // Generate learnings from the execution
    const newLearnings = await this.generateLearnings(this.task, result);
    this.learnings.push(...newLearnings);

    // Store learnings in memory if available
    if (this.config.enableLearning && this.memoryStore) {
      await this.storeLearnings(newLearnings);
    }

    this.phaseTimings.reflect = Date.now() - phaseStart;

    if (newLearnings.length > 0) {
      this.emitEvent('learning-captured', { learnings: newLearnings });
    }

    this.emitEvent('phase-completed', { phase: 'reflect', learnings: newLearnings });
  }

  private async generateLearnings(task: Task, result: ActResult): Promise<string[]> {
    const learnings: string[] = [];

    // Learn from successful patterns
    if (result.success) {
      if (result.artifacts.length > 0) {
        learnings.push(`Successfully generated ${result.artifacts.length} artifacts for ${task.type} task`);
      }

      if (result.tokensUsed.totalTokens > 0) {
        const efficiency = result.output.length / result.tokensUsed.totalTokens;
        if (efficiency > 10) {
          learnings.push(`High output efficiency achieved (${efficiency.toFixed(1)} chars/token)`);
        }
      }
    }

    // Learn from execution patterns
    if (result.duration > 30000) {
      learnings.push(`Task execution took ${(result.duration / 1000).toFixed(1)}s - consider breaking into smaller subtasks`);
    }

    // Extract insights from output
    const outputLower = result.output.toLowerCase();
    if (outputLower.includes('error') || outputLower.includes('warning')) {
      learnings.push('Output contained warnings/errors - review carefully before applying');
    }

    return learnings;
  }

  private async storeLearnings(learnings: string[]): Promise<void> {
    if (!this.memoryStore || !this.task) return;

    for (const learning of learnings) {
      const memory: Memory = {
        id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: 'semantic',
        content: learning,
        confidence: 0.7,
        createdAt: new Date(),
        accessedAt: new Date(),
        accessCount: 1,
        tags: [this.task.type, 'learning'],
        metadata: {
          taskId: this.task.id,
          phase: 'reflect',
        },
      };

      await this.memoryStore.store(memory);
    }
  }

  // ==========================================================================
  // Phase 4: VERIFY
  // ==========================================================================

  private async verify(result: ActResult): Promise<VerifyResult> {
    this.setPhase('verify');
    const phaseStart = Date.now();

    if (!this.task) {
      throw new Error('No task set for verify phase');
    }

    const gateResults: QualityGateResult[] = [];
    const blockers: QualityIssue[] = [];
    const suggestions: string[] = [];

    // Run verification checks based on task type and confidence tier
    const tier = this.task.confidence >= 0.90 ? 1 :
                 this.task.confidence >= 0.60 ? 2 :
                 this.task.confidence >= 0.30 ? 3 : 4;

    // Tier 1+: Static analysis
    if (tier <= 3) {
      const staticResult = await this.runStaticAnalysis(result);
      gateResults.push(staticResult);
      if (!staticResult.passed) {
        blockers.push(...staticResult.issues.filter(i =>
          i.severity === 'critical' || i.severity === 'high'
        ));
      }
    }

    // Tier 2+: Automated tests
    if (tier >= 2 && tier <= 3) {
      const testResult = await this.runAutomatedTests(result);
      gateResults.push(testResult);
      if (!testResult.passed) {
        blockers.push(...testResult.issues.filter(i =>
          i.severity === 'critical' || i.severity === 'high'
        ));
      }
    }

    // Tier 3: Code review
    if (tier === 3) {
      const reviewResult = await this.runCodeReview(result);
      gateResults.push(reviewResult);
      suggestions.push(...reviewResult.suggestions);
    }

    // Calculate overall score
    const passedGates = gateResults.filter(g => g.passed).length;
    const overallScore = gateResults.length > 0
      ? passedGates / gateResults.length
      : 1.0;

    const passed = blockers.length === 0 && overallScore >= 0.5;

    const verifyResult: VerifyResult = {
      passed,
      gateResults,
      overallScore,
      blockers,
      suggestions,
    };

    this.phaseTimings.verify = Date.now() - phaseStart;
    this.emitEvent('phase-completed', { phase: 'verify', result: verifyResult });

    return verifyResult;
  }

  private async runStaticAnalysis(result: ActResult): Promise<QualityGateResult> {
    // Simulate static analysis - in production, would integrate with ESLint, TypeScript, etc.
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];

    for (const artifact of result.artifacts) {
      if (artifact.type === 'code') {
        // Basic checks
        if (artifact.content.includes('console.log')) {
          issues.push({
            severity: 'low',
            category: 'best-practices',
            message: 'Remove console.log statements before production',
          });
        }

        if (artifact.content.includes('TODO') || artifact.content.includes('FIXME')) {
          issues.push({
            severity: 'info',
            category: 'maintenance',
            message: 'Code contains TODO/FIXME comments',
          });
        }

        if (artifact.content.includes('any')) {
          issues.push({
            severity: 'medium',
            category: 'typescript',
            message: 'Avoid using `any` type - prefer explicit types',
          });
        }
      }
    }

    const criticalOrHigh = issues.filter(i =>
      i.severity === 'critical' || i.severity === 'high'
    ).length;

    return {
      gate: 'static-analysis',
      passed: criticalOrHigh === 0,
      score: 1 - (issues.length * 0.1),
      issues,
      suggestions,
    };
  }

  private async runAutomatedTests(result: ActResult): Promise<QualityGateResult> {
    // Simulate test execution - in production, would run actual test suites
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];

    const testArtifacts = result.artifacts.filter(a => a.type === 'test');

    if (testArtifacts.length === 0) {
      suggestions.push('Consider adding unit tests for the implemented functionality');
    }

    return {
      gate: 'automated-tests',
      passed: true,
      score: testArtifacts.length > 0 ? 1.0 : 0.5,
      issues,
      suggestions,
    };
  }

  private async runCodeReview(result: ActResult): Promise<QualityGateResult> {
    // Simulate code review - in production, would use LLM for review
    const issues: QualityIssue[] = [];
    const suggestions: string[] = [];

    // Basic review checks
    const codeArtifacts = result.artifacts.filter(a => a.type === 'code');

    for (const artifact of codeArtifacts) {
      if (artifact.content.length > 500) {
        suggestions.push('Consider breaking large code blocks into smaller functions');
      }
    }

    suggestions.push('Ensure proper error handling is implemented');
    suggestions.push('Add inline documentation for complex logic');

    return {
      gate: 'code-review',
      passed: issues.filter(i => i.severity === 'critical').length === 0,
      score: 0.8,
      issues,
      suggestions,
    };
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private setPhase(phase: RARVPhase): void {
    this.currentPhase = phase;
    this.emitEvent('phase-started', { phase });
  }

  private emitEvent(type: RARVEventType, data: Record<string, unknown>): void {
    if (!this.task) return;

    const event: RARVEvent = {
      type,
      taskId: this.task.id,
      phase: this.currentPhase,
      timestamp: new Date(),
      data,
    };

    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  private addTokens(usage: TokenUsage): void {
    this.totalTokens.inputTokens += usage.inputTokens;
    this.totalTokens.outputTokens += usage.outputTokens;
    this.totalTokens.totalTokens += usage.totalTokens;

    if (this.task) {
      const cost = this.provider.estimateCost(
        usage.inputTokens,
        usage.outputTokens,
        this.provider.getModel(this.config.executionModel)
      );
      this.emitEvent('cost-incurred', { cost, usage });
    }
  }

  private resetTokens(): void {
    this.totalTokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  private resetPhaseTimings(): void {
    this.phaseTimings = { idle: 0, reason: 0, act: 0, reflect: 0, verify: 0 };
  }

  private createSuccessResult(actResult: ActResult, verifyResult: VerifyResult): TaskResult {
    return {
      taskId: this.task!.id,
      success: true,
      output: actResult.output,
      artifacts: this.artifacts,
      learnings: this.learnings,
      metrics: this.createMetrics(),
      errors: [],
      retryCount: this.retryCount,
    };
  }

  private createFailureResult(errors: TaskError[]): TaskResult {
    return {
      taskId: this.task?.id || 'unknown',
      success: false,
      output: '',
      artifacts: this.artifacts,
      learnings: this.learnings,
      metrics: this.createMetrics(),
      errors,
      retryCount: this.retryCount,
    };
  }

  private createMetrics(): TaskMetrics {
    return {
      totalTokens: this.totalTokens.totalTokens,
      inputTokens: this.totalTokens.inputTokens,
      outputTokens: this.totalTokens.outputTokens,
      cost: this.provider.estimateCost(
        this.totalTokens.inputTokens,
        this.totalTokens.outputTokens,
        this.provider.getModel(this.config.executionModel)
      ),
      duration: Date.now() - this.startTime,
      phaseTimings: { ...this.phaseTimings },
    };
  }

  private createTaskError(error: unknown, phase: RARVPhase): TaskError {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    return {
      code: 'EXECUTION_ERROR',
      message,
      phase,
      recoverable: this.isRecoverableError(error),
      stack,
    };
  }

  private isRecoverableError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      // Network errors and rate limits are recoverable
      return message.includes('network') ||
             message.includes('timeout') ||
             message.includes('rate limit') ||
             message.includes('429') ||
             message.includes('503');
    }
    return false;
  }

  private extractLearningsFromFailure(verifyResult: VerifyResult): string[] {
    const learnings: string[] = [];

    for (const blocker of verifyResult.blockers) {
      learnings.push(`Failed verification: ${blocker.message} (${blocker.category})`);
    }

    for (const suggestion of verifyResult.suggestions) {
      learnings.push(`Suggestion: ${suggestion}`);
    }

    return learnings;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Memory Store Interface
// ============================================================================

export interface MemoryStore {
  query(params: MemoryQuery): Promise<Memory[]>;
  store(memory: Memory): Promise<void>;
  update(id: string, updates: Partial<Memory>): Promise<void>;
  delete(id: string): Promise<void>;
}

interface MemoryQuery {
  type?: MemoryType;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
  searchText?: string;
}

// ============================================================================
// Exports
// ============================================================================

export { RARVConfig };
