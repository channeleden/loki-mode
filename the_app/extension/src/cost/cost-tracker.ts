/**
 * Cost Tracker (EXT-009)
 * Tracks costs at task, session, and daily levels with budget management
 */

import { calculateCost, formatCost, resolveModel } from './pricing';

export interface RequestCost {
  id: string;
  timestamp: Date;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface TaskCost {
  taskId: string;
  taskName?: string;
  startTime: Date;
  endTime?: Date;
  requests: RequestCost[];
  totalTokens: { input: number; output: number };
  totalCost: number;
}

export interface BudgetConfig {
  taskBudget: number;      // Default $5
  sessionBudget: number;   // Default $50
  dailyBudget: number;     // Default $100
  warningThreshold: number; // Percentage at which to warn (default 0.8 = 80%)
}

export interface BudgetStatus {
  task: {
    current: number;
    budget: number;
    remaining: number;
    percentage: number;
  };
  session: {
    current: number;
    budget: number;
    remaining: number;
    percentage: number;
  };
  daily: {
    current: number;
    budget: number;
    remaining: number;
    percentage: number;
  };
}

export interface BudgetWarning {
  level: 'task' | 'session' | 'daily';
  severity: 'warning' | 'critical' | 'exceeded';
  message: string;
  current: number;
  budget: number;
  percentage: number;
}

export interface CostExportEntry {
  timestamp: string;
  taskId: string;
  taskName?: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export class CostTracker {
  private sessionCost: number = 0;
  private taskCosts: Map<string, TaskCost> = new Map();
  private dailyCost: number = 0;
  private dailyDate: string;
  private budgets: BudgetConfig;
  private currentTaskId: string | null = null;
  private sessionStartTime: Date;
  private allRequests: RequestCost[] = [];

  constructor(budgets?: Partial<BudgetConfig>) {
    this.budgets = {
      taskBudget: budgets?.taskBudget ?? 5,
      sessionBudget: budgets?.sessionBudget ?? 50,
      dailyBudget: budgets?.dailyBudget ?? 100,
      warningThreshold: budgets?.warningThreshold ?? 0.8,
    };
    this.dailyDate = this.getTodayString();
    this.sessionStartTime = new Date();
  }

  private getTodayString(): string {
    return new Date().toISOString().split('T')[0];
  }

  private checkDayRollover(): void {
    const today = this.getTodayString();
    if (today !== this.dailyDate) {
      this.dailyCost = 0;
      this.dailyDate = today;
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start tracking a new task
   */
  startTask(taskId: string, taskName?: string): void {
    if (!this.taskCosts.has(taskId)) {
      this.taskCosts.set(taskId, {
        taskId,
        taskName,
        startTime: new Date(),
        requests: [],
        totalTokens: { input: 0, output: 0 },
        totalCost: 0,
      });
    }
    this.currentTaskId = taskId;
  }

  /**
   * End tracking for a task
   */
  endTask(taskId?: string): void {
    const id = taskId || this.currentTaskId;
    if (id) {
      const task = this.taskCosts.get(id);
      if (task) {
        task.endTime = new Date();
      }
      if (this.currentTaskId === id) {
        this.currentTaskId = null;
      }
    }
  }

  /**
   * Track per-request costs
   */
  trackRequest(
    taskId: string,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): RequestCost {
    this.checkDayRollover();

    // Resolve model to get provider
    const resolved = resolveModel(model);
    const provider = resolved?.provider || 'unknown';
    const cost = calculateCost(model, inputTokens, outputTokens);

    const request: RequestCost = {
      id: this.generateRequestId(),
      timestamp: new Date(),
      model,
      provider,
      inputTokens,
      outputTokens,
      cost,
    };

    // Ensure task exists
    if (!this.taskCosts.has(taskId)) {
      this.startTask(taskId);
    }

    // Update task costs
    const task = this.taskCosts.get(taskId)!;
    task.requests.push(request);
    task.totalTokens.input += inputTokens;
    task.totalTokens.output += outputTokens;
    task.totalCost += cost;

    // Update session and daily totals
    this.sessionCost += cost;
    this.dailyCost += cost;

    // Store in all requests for export
    this.allRequests.push(request);

    return request;
  }

  /**
   * Get costs for a specific task
   */
  getTaskCost(taskId: string): TaskCost | null {
    return this.taskCosts.get(taskId) || null;
  }

  /**
   * Get current task cost (if tracking a task)
   */
  getCurrentTaskCost(): number {
    if (this.currentTaskId) {
      return this.taskCosts.get(this.currentTaskId)?.totalCost || 0;
    }
    return 0;
  }

  /**
   * Get total session cost
   */
  getSessionCost(): number {
    return this.sessionCost;
  }

  /**
   * Get daily cost
   */
  getDailyCost(): number {
    this.checkDayRollover();
    return this.dailyCost;
  }

  /**
   * Get all task summaries
   */
  getAllTaskCosts(): TaskCost[] {
    return Array.from(this.taskCosts.values());
  }

  /**
   * Check budget status at all levels
   */
  checkBudget(): BudgetStatus {
    const currentTaskCost = this.getCurrentTaskCost();

    return {
      task: {
        current: currentTaskCost,
        budget: this.budgets.taskBudget,
        remaining: Math.max(0, this.budgets.taskBudget - currentTaskCost),
        percentage: currentTaskCost / this.budgets.taskBudget,
      },
      session: {
        current: this.sessionCost,
        budget: this.budgets.sessionBudget,
        remaining: Math.max(0, this.budgets.sessionBudget - this.sessionCost),
        percentage: this.sessionCost / this.budgets.sessionBudget,
      },
      daily: {
        current: this.getDailyCost(),
        budget: this.budgets.dailyBudget,
        remaining: Math.max(0, this.budgets.dailyBudget - this.dailyCost),
        percentage: this.dailyCost / this.budgets.dailyBudget,
      },
    };
  }

  /**
   * Check if any budget is exceeded
   */
  isOverBudget(): boolean {
    const status = this.checkBudget();
    return (
      status.task.percentage >= 1 ||
      status.session.percentage >= 1 ||
      status.daily.percentage >= 1
    );
  }

  /**
   * Get budget warnings
   */
  getBudgetWarnings(): BudgetWarning[] {
    const warnings: BudgetWarning[] = [];
    const status = this.checkBudget();
    const threshold = this.budgets.warningThreshold;

    const checkLevel = (
      level: 'task' | 'session' | 'daily',
      data: BudgetStatus['task']
    ) => {
      if (data.percentage >= 1) {
        warnings.push({
          level,
          severity: 'exceeded',
          message: `${level.charAt(0).toUpperCase() + level.slice(1)} budget exceeded: ${formatCost(data.current)} / ${formatCost(data.budget)}`,
          current: data.current,
          budget: data.budget,
          percentage: data.percentage,
        });
      } else if (data.percentage >= 0.95) {
        warnings.push({
          level,
          severity: 'critical',
          message: `${level.charAt(0).toUpperCase() + level.slice(1)} budget at ${(data.percentage * 100).toFixed(1)}%: ${formatCost(data.current)} / ${formatCost(data.budget)}`,
          current: data.current,
          budget: data.budget,
          percentage: data.percentage,
        });
      } else if (data.percentage >= threshold) {
        warnings.push({
          level,
          severity: 'warning',
          message: `${level.charAt(0).toUpperCase() + level.slice(1)} budget at ${(data.percentage * 100).toFixed(1)}%: ${formatCost(data.current)} / ${formatCost(data.budget)}`,
          current: data.current,
          budget: data.budget,
          percentage: data.percentage,
        });
      }
    };

    checkLevel('task', status.task);
    checkLevel('session', status.session);
    checkLevel('daily', status.daily);

    return warnings;
  }

  /**
   * Update budget configuration
   */
  updateBudgets(budgets: Partial<BudgetConfig>): void {
    this.budgets = { ...this.budgets, ...budgets };
  }

  /**
   * Get current budget configuration
   */
  getBudgets(): BudgetConfig {
    return { ...this.budgets };
  }

  /**
   * Reset session costs (start new session)
   */
  resetSession(): void {
    this.sessionCost = 0;
    this.taskCosts.clear();
    this.currentTaskId = null;
    this.sessionStartTime = new Date();
    this.allRequests = [];
  }

  /**
   * Export costs for enterprise chargeback
   */
  exportCosts(format: 'json' | 'csv'): string {
    const entries: CostExportEntry[] = [];

    for (const task of this.taskCosts.values()) {
      for (const request of task.requests) {
        entries.push({
          timestamp: request.timestamp.toISOString(),
          taskId: task.taskId,
          taskName: task.taskName,
          model: request.model,
          provider: request.provider,
          inputTokens: request.inputTokens,
          outputTokens: request.outputTokens,
          cost: request.cost,
        });
      }
    }

    if (format === 'json') {
      return JSON.stringify({
        exportDate: new Date().toISOString(),
        sessionStartTime: this.sessionStartTime.toISOString(),
        summary: {
          totalSessionCost: this.sessionCost,
          totalDailyCost: this.dailyCost,
          taskCount: this.taskCosts.size,
          requestCount: entries.length,
        },
        budgets: this.budgets,
        entries,
      }, null, 2);
    }

    // CSV format
    const headers = [
      'timestamp',
      'taskId',
      'taskName',
      'model',
      'provider',
      'inputTokens',
      'outputTokens',
      'cost',
    ];

    const rows = entries.map(entry => [
      entry.timestamp,
      entry.taskId,
      entry.taskName || '',
      entry.model,
      entry.provider,
      entry.inputTokens.toString(),
      entry.outputTokens.toString(),
      entry.cost.toFixed(6),
    ].map(val => `"${val}"`).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Get session duration in milliseconds
   */
  getSessionDuration(): number {
    return Date.now() - this.sessionStartTime.getTime();
  }

  /**
   * Get cost per hour for the current session
   */
  getSessionCostPerHour(): number {
    const hours = this.getSessionDuration() / (1000 * 60 * 60);
    if (hours < 0.01) return 0;
    return this.sessionCost / hours;
  }

  /**
   * Get statistics summary
   */
  getStatistics(): {
    sessionCost: number;
    dailyCost: number;
    taskCount: number;
    requestCount: number;
    avgCostPerTask: number;
    avgCostPerRequest: number;
    sessionDuration: number;
    costPerHour: number;
  } {
    const taskCount = this.taskCosts.size;
    const requestCount = this.allRequests.length;

    return {
      sessionCost: this.sessionCost,
      dailyCost: this.dailyCost,
      taskCount,
      requestCount,
      avgCostPerTask: taskCount > 0 ? this.sessionCost / taskCount : 0,
      avgCostPerRequest: requestCount > 0 ? this.sessionCost / requestCount : 0,
      sessionDuration: this.getSessionDuration(),
      costPerHour: this.getSessionCostPerHour(),
    };
  }
}
