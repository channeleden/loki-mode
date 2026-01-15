/**
 * Autonomi Extension - Core Types
 * Version: 1.0.0
 */

// ============================================================================
// RARV Cycle Types
// ============================================================================

export type RARVPhase = 'idle' | 'reason' | 'act' | 'reflect' | 'verify';

export interface Task {
  id: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  confidence: number;
  estimatedCost: number;
  createdAt: Date;
  updatedAt: Date;
  parentTaskId?: string;
  subtasks?: string[];
  context: TaskContext;
  metadata: Record<string, unknown>;
}

export type TaskType =
  | 'frontend'
  | 'backend'
  | 'database'
  | 'api'
  | 'devops'
  | 'qa'
  | 'code-review'
  | 'security-review'
  | 'test-gen'
  | 'perf'
  | 'docs'
  | 'refactor'
  | 'migration'
  | 'architect'
  | 'decomposition'
  | 'general';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'awaiting-approval'
  | 'in-progress'
  | 'reviewing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskContext {
  files: string[];
  workspaceRoot: string;
  language?: string;
  framework?: string;
  dependencies?: string[];
  relatedTasks?: string[];
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: string;
  artifacts: Artifact[];
  learnings: string[];
  metrics: TaskMetrics;
  errors: TaskError[];
  retryCount: number;
}

export interface TaskError {
  code: string;
  message: string;
  phase: RARVPhase;
  recoverable: boolean;
  stack?: string;
}

export interface TaskMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  duration: number;
  phaseTimings: Record<RARVPhase, number>;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  name: string;
  content: string;
  path?: string;
  mimeType?: string;
}

export type ArtifactType =
  | 'code'
  | 'test'
  | 'documentation'
  | 'config'
  | 'diagram'
  | 'report'
  | 'other';

// ============================================================================
// Agent Types
// ============================================================================

export type AgentType =
  // Engineering agents
  | 'frontend'
  | 'backend'
  | 'database'
  | 'api'
  | 'devops'
  | 'qa'
  // Quality agents
  | 'code-review'
  | 'security-review'
  | 'test-gen'
  | 'perf'
  // Support agents
  | 'docs'
  | 'refactor'
  | 'migration'
  // Planning agents
  | 'architect'
  | 'decomposition';

export interface AgentResult {
  agentType: AgentType;
  taskId: string;
  success: boolean;
  output: string;
  artifacts: Artifact[];
  confidence: number;
  reasoning: string;
  suggestedNextSteps?: string[];
  warnings?: string[];
}

export interface AgentConfig {
  type: AgentType;
  model: ModelTier;
  maxTokens: number;
  temperature: number;
  systemPromptOverride?: string;
}

// ============================================================================
// Provider Types
// ============================================================================

export type ProviderType = 'anthropic' | 'openai' | 'google' | 'local';

export type ModelTier = 'opus' | 'sonnet' | 'haiku';

export interface Provider {
  type: ProviderType;
  isAvailable(): Promise<boolean>;
  getModel(tier: ModelTier): string;
  generateCompletion(request: CompletionRequest): Promise<CompletionResponse>;
  streamCompletion(request: CompletionRequest): AsyncGenerator<StreamChunk>;
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

export interface CompletionRequest {
  model: string;
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  tools?: Tool[];
}

export interface CompletionResponse {
  id: string;
  content: string;
  model: string;
  usage: TokenUsage;
  stopReason: StopReason;
  toolCalls?: ToolCall[];
}

export interface StreamChunk {
  type: 'text' | 'thinking' | 'tool_use' | 'done';
  content: string;
  delta?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type StopReason = 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use';

// ============================================================================
// Tool Types
// ============================================================================

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Memory Types
// ============================================================================

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  confidence: number;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  tags: string[];
  metadata: Record<string, unknown>;
}

export type MemoryType = 'episodic' | 'semantic' | 'procedural';

export interface MemoryQuery {
  type?: MemoryType;
  tags?: string[];
  minConfidence?: number;
  limit?: number;
  searchText?: string;
}

// ============================================================================
// Queue Types
// ============================================================================

export interface TaskQueueItem {
  task: Task;
  priority: number;
  addedAt: Date;
  attempts: number;
  lastAttemptAt?: Date;
  error?: string;
}

export interface TaskQueueStatus {
  pending: number;
  inProgress: number;
  completed: number;
  failed: number;
  totalCost: number;
}

// ============================================================================
// Orchestrator Types
// ============================================================================

export interface OrchestratorStatus {
  isRunning: boolean;
  activeAgents: AgentStatus[];
  queueStatus: TaskQueueStatus;
  currentPhase: RARVPhase;
  totalCost: number;
  uptime: number;
}

export interface AgentStatus {
  id: string;
  type: AgentType;
  taskId: string;
  phase: RARVPhase;
  startedAt: Date;
  progress: number;
}

// ============================================================================
// Quality Types
// ============================================================================

export interface QualityGateResult {
  gate: QualityGate;
  passed: boolean;
  score?: number;
  issues: QualityIssue[];
  suggestions: string[];
}

export type QualityGate =
  | 'static-analysis'
  | 'automated-tests'
  | 'code-review'
  | 'security-scan';

export interface QualityIssue {
  severity: IssueSeverity;
  category: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
}

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// ============================================================================
// Configuration Types
// ============================================================================

export interface ExtensionConfig {
  providers: ProviderConfig[];
  activeProvider: ProviderType;
  autonomyLevel: AutonomyLevel;
  approvalGates: ApprovalGateConfig;
  qualityGates: QualityGateConfig;
  budgets: BudgetConfig;
  memory: MemoryConfig;
}

export interface ProviderConfig {
  type: ProviderType;
  enabled: boolean;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export type AutonomyLevel = 'full' | 'guided' | 'approval-required';

export interface ApprovalGateConfig {
  productionDeploy: boolean;
  databaseMigration: boolean;
  securityChanges: boolean;
  newDependencies: boolean;
  fileDeletion: boolean;
  costThreshold: number;
}

export interface QualityGateConfig {
  staticAnalysis: { enabled: boolean; blocking: boolean };
  automatedTests: { enabled: boolean; blocking: boolean };
  codeReview: { enabled: boolean; blocking: boolean };
  securityScan: { enabled: boolean; blocking: boolean };
}

export interface BudgetConfig {
  taskBudget: number;
  sessionBudget: number;
  dailyBudget: number;
}

export interface MemoryConfig {
  hotMemorySize: number;
  coldMemoryPath: string;
  consolidationInterval: number;
}

// ============================================================================
// Event Types
// ============================================================================

export interface RARVEvent {
  type: RARVEventType;
  taskId: string;
  phase: RARVPhase;
  timestamp: Date;
  data: Record<string, unknown>;
}

export type RARVEventType =
  | 'phase-started'
  | 'phase-completed'
  | 'phase-failed'
  | 'task-started'
  | 'task-completed'
  | 'task-failed'
  | 'retry-initiated'
  | 'learning-captured'
  | 'cost-incurred';

export type EventHandler = (event: RARVEvent) => void;

// ============================================================================
// RARV Result Types
// ============================================================================

export interface ReasonResult {
  plan: ExecutionPlan;
  selectedAgent: AgentType;
  confidence: number;
  reasoning: string;
  estimatedCost: number;
  warnings?: string[];
}

export interface ExecutionPlan {
  steps: PlanStep[];
  estimatedDuration: number;
  estimatedCost: number;
  affectedFiles: string[];
  risks: string[];
}

export interface PlanStep {
  id: string;
  description: string;
  type: 'read' | 'write' | 'execute' | 'verify';
  target?: string;
  dependencies: string[];
}

export interface ActResult {
  success: boolean;
  output: string;
  artifacts: Artifact[];
  toolCalls: ToolCall[];
  tokensUsed: TokenUsage;
  duration: number;
}

export interface VerifyResult {
  passed: boolean;
  gateResults: QualityGateResult[];
  overallScore: number;
  blockers: QualityIssue[];
  suggestions: string[];
}

// ============================================================================
// Confidence Calculation Types
// ============================================================================

export interface ConfidenceFactors {
  requirementClarity: number;  // 0-1, weight: 0.30
  technicalComplexity: number; // 0-1, weight: 0.25
  historicalSuccess: number;   // 0-1, weight: 0.25
  scopeSize: number;           // 0-1, weight: 0.20
}

export type ConfidenceTier = 1 | 2 | 3 | 4;

export interface ConfidenceResult {
  score: number;
  tier: ConfidenceTier;
  factors: ConfidenceFactors;
  recommendedModel: ModelTier;
  requiresApproval: boolean;
}
