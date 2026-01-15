/**
 * State management for Autonomi VSCode Extension
 */

import * as vscode from 'vscode';
import { ExecutionState, RARVPhase, Task, Plan, StateChangeEvent } from '../types';
import { Logger } from '../utils/logger';

const STATE_KEY = 'autonomi.executionState';

// Initial state
const INITIAL_STATE: ExecutionState = {
  phase: null,
  currentTask: null,
  pendingPlan: null,
  taskQueue: [],
  completedTasks: [],
  activeAgents: [],
  sessionCost: 0,
  isRunning: false,
  lastError: undefined,
  startedAt: undefined
};

export type StateListener = (state: ExecutionState, event?: StateChangeEvent) => void;

export class StateManager {
  private context: vscode.ExtensionContext;
  private state: ExecutionState;
  private listeners: Set<StateListener> = new Set();
  private saveDebounceTimer: NodeJS.Timeout | undefined;
  private saveDebounceMs: number = 1000;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.state = { ...INITIAL_STATE };
  }

  /**
   * Get the current state
   */
  getState(): ExecutionState {
    return { ...this.state };
  }

  /**
   * Update state with partial updates
   */
  setState(updates: Partial<ExecutionState>, event?: StateChangeEvent): void {
    const previousState = { ...this.state };
    this.state = { ...this.state, ...updates };

    // Notify listeners
    this.notifyListeners(event);

    // Debounced save to persistence
    this.debouncedSave();

    Logger.debug('State updated', {
      changes: Object.keys(updates),
      event: event?.type
    });
  }

  /**
   * Set current phase
   */
  setPhase(phase: RARVPhase | null): void {
    this.setState({ phase }, phase ? { type: 'phase_change', phase } : undefined);
  }

  /**
   * Set current task
   */
  setCurrentTask(task: Task | null): void {
    const event: StateChangeEvent | undefined = task
      ? { type: 'task_started', task }
      : undefined;
    this.setState({ currentTask: task }, event);
  }

  /**
   * Set pending plan
   */
  setPendingPlan(plan: Plan | null): void {
    const event: StateChangeEvent | undefined = plan
      ? { type: 'plan_pending', plan }
      : undefined;
    this.setState({ pendingPlan: plan }, event);
  }

  /**
   * Add task to queue
   */
  addToQueue(task: Task): void {
    const taskQueue = [...this.state.taskQueue, task];
    this.setState({ taskQueue });
  }

  /**
   * Remove task from queue
   */
  removeFromQueue(taskId: string): void {
    const taskQueue = this.state.taskQueue.filter(t => t.id !== taskId);
    this.setState({ taskQueue });
  }

  /**
   * Mark task as completed
   */
  completeTask(task: Task): void {
    const completedTasks = [...this.state.completedTasks, task];
    // Keep only last 100 completed tasks
    if (completedTasks.length > 100) {
      completedTasks.shift();
    }
    this.setState(
      { currentTask: null, completedTasks },
      { type: 'task_completed', task }
    );
  }

  /**
   * Mark task as failed
   */
  failTask(task: Task, error: string): void {
    this.setState(
      { currentTask: null, lastError: error },
      { type: 'task_failed', task, error }
    );
  }

  /**
   * Update session cost
   */
  updateCost(cost: number): void {
    const sessionCost = this.state.sessionCost + cost;
    this.setState({ sessionCost }, { type: 'cost_updated', sessionCost });
  }

  /**
   * Add active agent
   */
  addActiveAgent(agentId: string, agentType: import('../types').AgentType): void {
    if (!this.state.activeAgents.includes(agentId)) {
      const activeAgents = [...this.state.activeAgents, agentId];
      this.setState({ activeAgents }, { type: 'agent_started', agentId, agentType });
    }
  }

  /**
   * Remove active agent
   */
  removeActiveAgent(agentId: string): void {
    const activeAgents = this.state.activeAgents.filter(id => id !== agentId);
    this.setState({ activeAgents }, { type: 'agent_completed', agentId });
  }

  /**
   * Start execution
   */
  startExecution(): void {
    this.setState({ isRunning: true, startedAt: Date.now(), lastError: undefined });
  }

  /**
   * Stop execution
   */
  stopExecution(): void {
    this.setState({ isRunning: false, phase: null });
  }

  /**
   * Approve pending plan
   */
  approvePlan(): void {
    if (this.state.pendingPlan) {
      const plan = { ...this.state.pendingPlan, approvedAt: Date.now() };
      this.setState(
        { pendingPlan: plan },
        { type: 'plan_approved', planId: plan.id }
      );
    }
  }

  /**
   * Reject pending plan
   */
  rejectPlan(): void {
    if (this.state.pendingPlan) {
      const planId = this.state.pendingPlan.id;
      this.setState({ pendingPlan: null }, { type: 'plan_rejected', planId });
    }
  }

  /**
   * Reset state to initial
   */
  reset(): void {
    this.state = { ...INITIAL_STATE };
    this.notifyListeners();
    this.save();
  }

  /**
   * Save state to persistent storage
   */
  async save(): Promise<void> {
    try {
      await this.context.workspaceState.update(STATE_KEY, this.state);
      Logger.debug('State saved to workspace storage');
    } catch (error) {
      Logger.error('Failed to save state', error as Error);
    }
  }

  /**
   * Debounced save to avoid excessive writes
   */
  private debouncedSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.save();
    }, this.saveDebounceMs);
  }

  /**
   * Restore state from persistent storage
   */
  async restore(): Promise<ExecutionState | undefined> {
    try {
      const savedState = this.context.workspaceState.get<ExecutionState>(STATE_KEY);
      if (savedState) {
        // Merge with initial state to handle any new fields
        this.state = { ...INITIAL_STATE, ...savedState };
        // Reset running state on restore (extension was restarted)
        this.state.isRunning = false;
        this.state.activeAgents = [];
        Logger.info('State restored from workspace storage');
        return this.state;
      }
    } catch (error) {
      Logger.error('Failed to restore state', error as Error);
    }
    return undefined;
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners of state change
   */
  private notifyListeners(event?: StateChangeEvent): void {
    const stateCopy = this.getState();
    this.listeners.forEach(listener => {
      try {
        listener(stateCopy, event);
      } catch (error) {
        Logger.error('State listener error', error as Error);
      }
    });
  }

  /**
   * Get task by ID from queue or completed
   */
  getTaskById(taskId: string): Task | undefined {
    if (this.state.currentTask?.id === taskId) {
      return this.state.currentTask;
    }
    const queuedTask = this.state.taskQueue.find(t => t.id === taskId);
    if (queuedTask) {
      return queuedTask;
    }
    return this.state.completedTasks.find(t => t.id === taskId);
  }

  /**
   * Dispose of the state manager
   */
  dispose(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    // Save final state synchronously-ish
    this.save();
    this.listeners.clear();
  }
}
