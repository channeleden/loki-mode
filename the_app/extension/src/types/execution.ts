/**
 * Execution types for Autonomi VSCode Extension
 * Core types for task execution, state management, and RARV cycle
 */

import { ConfidenceTier, TokenUsage } from '../providers/types';

// RARV Cycle phases
export type RARVPhase = 'idle' | 'reason' | 'act' | 'reflect' | 'verify';

// Task status
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused' | 'cancelled';

// Agent types available in the system
export type AgentType =
  // Engineering
  | 'frontend'
  | 'backend'
  | 'database'
  | 'api'
  | 'devops'
  | 'qa'
  // Quality
  | 'code_review'
  | 'security_review'
  | 'test_gen'
  | 'perf'
  // Support
  | 'docs'
  | 'refactor'
  | 'migration'
  // Planning
  | 'architect'
  | 'decomposition';

// Task definition
export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  agentType?: AgentType;
  priority: number;
  confidenceTier?: ConfidenceTier;
  confidence?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  parentTaskId?: string;
  subtaskIds?: string[];
  metadata?: Record<string, unknown>;
}

// Task result after completion
export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: string;
  error?: string;
  filesModified?: string[];
  testsRun?: number;
  testsPassed?: number;
  duration: number;
  tokenUsage?: TokenUsage;
  cost?: number;
}

// Execution plan step
export interface PlanStep {
  id: string;
  description: string;
  agentType: AgentType;
  estimatedTokens: number;
  estimatedCost: number;
  estimatedDuration: number;
  dependencies: string[];
  filesAffected: string[];
}

// Execution plan
export interface Plan {
  id: string;
  taskId: string;
  title: string;
  description: string;
  steps: PlanStep[];
  totalEstimatedTokens: number;
  totalEstimatedCost: number;
  totalEstimatedDuration: number;
  createdAt: number;
  approvedAt?: number;
  approved: boolean;
}

// Active agent instance
export interface ActiveAgent {
  id: string;
  type: AgentType;
  taskId: string;
  startedAt: number;
  currentStep?: string;
  progress?: number;
}

// Queue state
export interface QueueState {
  pending: Task[];
  inProgress: Task[];
  completed: Task[];
  failed: Task[];
}

// Cost tracking
export interface CostState {
  sessionCost: number;
  taskCost: number;
  dailyCost: number;
  budgetTask: number;
  budgetSession: number;
  budgetDaily: number;
}

// Overall execution state
export interface ExecutionState {
  phase: RARVPhase;
  isRunning: boolean;
  isPaused: boolean;
  currentTask?: Task;
  currentPlan?: Plan;
  activeAgents: ActiveAgent[];
  queue: QueueState;
  confidence: number;
  confidenceTier: ConfidenceTier;
  cost: CostState;
  sessionId: string;
  sessionStartedAt: number;
  lastUpdatedAt: number;
}

// State update event
export interface StateUpdateEvent {
  type: 'phase' | 'task' | 'agent' | 'queue' | 'cost' | 'full';
  timestamp: number;
  state: Partial<ExecutionState>;
}
