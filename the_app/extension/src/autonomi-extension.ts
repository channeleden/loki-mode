/**
 * Main extension class for Autonomi VSCode Extension
 */

import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { StateManager } from './state/state-manager';
import { ConfigManager } from './config/config-manager';
import { Logger, LogLevel } from './utils/logger';
import { TaskQueue } from './utils/task-queue';
import {
  ExecutionState,
  Task,
  TaskStatus,
  TaskPriority,
  Plan,
  RARVPhase,
  ConfidenceTier,
  AgentType
} from './types';

// Forward declarations for components to be implemented
interface AgentOrchestrator {
  executeTask(task: Task, plan: Plan): Promise<void>;
  stop(): Promise<void>;
  dispose(): void;
}

interface ProviderManager {
  initialize(): Promise<void>;
  getPreferredProvider(): string;
  dispose(): void;
}

interface CostTracker {
  getSessionCost(): number;
  addCost(cost: number): void;
  checkBudget(): { exceeded: boolean; budget: string; current: number; limit: number };
  dispose(): void;
}

interface PlanGenerator {
  generatePlan(task: Task): Promise<Plan>;
  dispose(): void;
}

interface ApprovalManager {
  requiresApproval(plan: Plan): boolean;
  requestApproval(plan: Plan): Promise<boolean>;
  dispose(): void;
}

interface ConfidenceCalculator {
  calculate(task: Task): Promise<{ confidence: number; tier: ConfidenceTier }>;
  dispose(): void;
}

interface AutonomiTreeProvider extends vscode.TreeDataProvider<unknown> {
  refresh(): void;
  dispose(): void;
}

interface StatusBarController {
  update(state: ExecutionState): void;
  dispose(): void;
}

interface AutonomiOutputChannel {
  appendLine(text: string): void;
  show(): void;
  dispose(): void;
}

/**
 * Main Autonomi Extension class
 */
export class AutonomiExtension implements vscode.Disposable {
  private context: vscode.ExtensionContext;
  private stateManager: StateManager;
  private configManager: ConfigManager;
  private taskQueue: TaskQueue;
  private outputChannel: vscode.OutputChannel;
  private disposables: vscode.Disposable[] = [];

  // Components (initialized lazily)
  private treeProvider: AutonomiTreeProvider | undefined;
  private statusBar: StatusBarController | undefined;
  private orchestrator: AgentOrchestrator | undefined;
  private providerManager: ProviderManager | undefined;
  private costTracker: CostTracker | undefined;
  private planGenerator: PlanGenerator | undefined;
  private approvalManager: ApprovalManager | undefined;
  private confidenceCalculator: ConfidenceCalculator | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.outputChannel = vscode.window.createOutputChannel('Autonomi');
    this.stateManager = new StateManager(context);
    this.configManager = new ConfigManager(context);
    this.taskQueue = new TaskQueue();
    this.disposables.push(this.outputChannel);
  }

  /**
   * Initialize the extension
   */
  async initialize(): Promise<void> {
    // 1. Initialize logger
    const logLevel = this.getLogLevel();
    Logger.initialize(this.outputChannel, logLevel);
    Logger.info('Initializing Autonomi extension...');

    try {
      // 2. Restore state if resuming
      await this.stateManager.restore();

      // 3. Register commands
      this.registerCommands();

      // 4. Set up UI components
      await this.setupUI();

      // 5. Set up event listeners
      this.setupEventListeners();

      // 6. Initialize providers (lazy - will init when first task starts)
      Logger.info('Autonomi extension initialized successfully');
    } catch (error) {
      Logger.error('Failed to initialize extension', error as Error);
      throw error;
    }
  }

  /**
   * Get log level from configuration
   */
  private getLogLevel(): LogLevel {
    const level = this.configManager.getLogLevel();
    switch (level.toLowerCase()) {
      case 'debug': return LogLevel.DEBUG;
      case 'info': return LogLevel.INFO;
      case 'warn': return LogLevel.WARN;
      case 'error': return LogLevel.ERROR;
      default: return LogLevel.INFO;
    }
  }

  /**
   * Register extension commands
   */
  private registerCommands(): void {
    const commands: Array<{ id: string; handler: (...args: unknown[]) => unknown }> = [
      {
        id: 'autonomi.startTask',
        handler: () => this.promptAndStartTask()
      },
      {
        id: 'autonomi.stopTask',
        handler: () => this.stopTask()
      },
      {
        id: 'autonomi.approvePlan',
        handler: (planId?: string) => this.approvePlan(planId)
      },
      {
        id: 'autonomi.rejectPlan',
        handler: (planId?: string) => this.rejectPlan(planId)
      },
      {
        id: 'autonomi.showOutput',
        handler: () => this.outputChannel.show()
      },
      {
        id: 'autonomi.configureApiKeys',
        handler: () => this.configureApiKeys()
      },
      {
        id: 'autonomi.showStatus',
        handler: () => this.showStatus()
      },
      {
        id: 'autonomi.clearQueue',
        handler: () => this.clearQueue()
      },
      {
        id: 'autonomi.openSettings',
        handler: () => vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'autonomi'
        )
      }
    ];

    for (const { id, handler } of commands) {
      const disposable = vscode.commands.registerCommand(id, handler);
      this.disposables.push(disposable);
    }

    Logger.debug(`Registered ${commands.length} commands`);
  }

  /**
   * Set up UI components
   */
  private async setupUI(): Promise<void> {
    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    statusBarItem.command = 'autonomi.showStatus';
    statusBarItem.text = '$(circuit-board) Autonomi: Ready';
    statusBarItem.tooltip = 'Click to show Autonomi status';
    statusBarItem.show();
    this.disposables.push(statusBarItem);

    // Subscribe to state changes to update status bar
    this.stateManager.subscribe((state) => {
      this.updateStatusBar(statusBarItem, state);
    });

    Logger.debug('UI components set up');
  }

  /**
   * Update status bar based on state
   */
  private updateStatusBar(
    statusBarItem: vscode.StatusBarItem,
    state: ExecutionState
  ): void {
    if (!state.isRunning) {
      statusBarItem.text = '$(circuit-board) Autonomi: Ready';
      statusBarItem.backgroundColor = undefined;
    } else if (state.pendingPlan && !state.pendingPlan.approvedAt) {
      statusBarItem.text = '$(question) Autonomi: Awaiting Approval';
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else if (state.phase) {
      const phaseIcons: Record<RARVPhase, string> = {
        [RARVPhase.REASON]: '$(lightbulb)',
        [RARVPhase.ACT]: '$(play)',
        [RARVPhase.REFLECT]: '$(mirror)',
        [RARVPhase.VERIFY]: '$(check)'
      };
      const icon = phaseIcons[state.phase] || '$(sync~spin)';
      statusBarItem.text = `${icon} Autonomi: ${state.phase.toUpperCase()} | $${state.sessionCost.toFixed(2)}`;
      statusBarItem.backgroundColor = undefined;
    } else {
      statusBarItem.text = `$(sync~spin) Autonomi: Running | $${state.sessionCost.toFixed(2)}`;
      statusBarItem.backgroundColor = undefined;
    }
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen for configuration changes
    const configDisposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('autonomi')) {
        Logger.info('Configuration changed, reloading...');
        // Update log level if changed
        const newLevel = this.getLogLevel();
        Logger.setLevel(newLevel);
      }
    });
    this.disposables.push(configDisposable);
  }

  /**
   * Prompt user for task description and start task
   */
  private async promptAndStartTask(): Promise<void> {
    const description = await vscode.window.showInputBox({
      prompt: 'Enter task description',
      placeHolder: 'e.g., Add a login form to the homepage',
      ignoreFocusOut: true
    });

    if (description) {
      await this.startTask(description);
    }
  }

  /**
   * Start a new task
   */
  async startTask(description: string): Promise<void> {
    Logger.info(`Starting task: ${description}`);

    const state = this.stateManager.getState();
    if (state.isRunning && state.currentTask) {
      // Queue the task if already running
      const task = this.createTask(description);
      this.taskQueue.enqueue(task);
      this.stateManager.addToQueue(task);
      vscode.window.showInformationMessage(`Task queued: ${description}`);
      Logger.info(`Task queued: ${task.id}`);
      return;
    }

    // Create and execute task
    const task = this.createTask(description);
    await this.executeTask(task);
  }

  /**
   * Create a new task
   */
  private createTask(description: string, priority: TaskPriority = TaskPriority.NORMAL): Task {
    return {
      id: uuidv4(),
      description,
      status: TaskStatus.PENDING,
      priority,
      createdAt: Date.now()
    };
  }

  /**
   * Execute a task through the RARV cycle
   */
  private async executeTask(task: Task): Promise<void> {
    try {
      // Start execution
      this.stateManager.startExecution();
      this.stateManager.setCurrentTask(task);

      // 1. Calculate confidence
      const confidence = await this.calculateConfidence(task);
      task.confidence = confidence.confidence;
      task.confidenceTier = confidence.tier;
      Logger.info(`Task confidence: ${confidence.confidence.toFixed(2)} (Tier ${confidence.tier})`);

      // 2. Generate plan
      this.stateManager.setPhase(RARVPhase.REASON);
      const plan = await this.generatePlan(task);
      Logger.info(`Plan generated: ${plan.id} with ${plan.steps.length} steps`);

      // 3. Request approval if needed
      if (plan.requiresApproval) {
        this.stateManager.setPendingPlan(plan);
        task.status = TaskStatus.AWAITING_APPROVAL;

        const autoApprove = this.configManager.isAutoApproveEnabled();
        const threshold = this.configManager.getAutoApproveThreshold();

        if (autoApprove && confidence.confidence >= threshold) {
          Logger.info(`Auto-approving plan (confidence ${confidence.confidence} >= ${threshold})`);
          await this.approvePlan(plan.id);
        } else {
          vscode.window.showInformationMessage(
            `Plan ready for review. Estimated cost: $${plan.totalEstimatedCost.toFixed(2)}`,
            'Approve',
            'Reject'
          ).then(action => {
            if (action === 'Approve') {
              this.approvePlan(plan.id);
            } else if (action === 'Reject') {
              this.rejectPlan(plan.id);
            }
          });
          return; // Wait for user action
        }
      }

      // 4. Execute RARV cycle
      await this.executeRARVCycle(task, plan);

    } catch (error) {
      Logger.error('Task execution failed', error as Error);
      task.status = TaskStatus.FAILED;
      task.error = (error as Error).message;
      this.stateManager.failTask(task, task.error);
      vscode.window.showErrorMessage(`Task failed: ${task.error}`);
    }
  }

  /**
   * Calculate confidence for a task
   */
  private async calculateConfidence(task: Task): Promise<{ confidence: number; tier: ConfidenceTier }> {
    // Placeholder implementation
    // TODO: Implement actual confidence calculation using ConfidenceCalculator
    const complexity = this.estimateComplexity(task.description);
    const confidence = Math.max(0.1, 1.0 - complexity * 0.2);

    const thresholds = this.configManager.getConfidenceTierThresholds();
    let tier: ConfidenceTier;
    if (confidence >= thresholds[ConfidenceTier.TIER_1]) {
      tier = ConfidenceTier.TIER_1;
    } else if (confidence >= thresholds[ConfidenceTier.TIER_2]) {
      tier = ConfidenceTier.TIER_2;
    } else if (confidence >= thresholds[ConfidenceTier.TIER_3]) {
      tier = ConfidenceTier.TIER_3;
    } else {
      tier = ConfidenceTier.TIER_4;
    }

    return { confidence, tier };
  }

  /**
   * Estimate task complexity based on description
   */
  private estimateComplexity(description: string): number {
    const words = description.toLowerCase();
    let complexity = 0;

    // Simple heuristics
    if (words.includes('refactor')) complexity += 1;
    if (words.includes('migrate')) complexity += 2;
    if (words.includes('architecture')) complexity += 2;
    if (words.includes('database')) complexity += 1;
    if (words.includes('security')) complexity += 1;
    if (words.includes('authentication')) complexity += 1;
    if (words.includes('api')) complexity += 0.5;
    if (words.includes('test')) complexity -= 0.5;
    if (words.includes('simple')) complexity -= 1;
    if (words.includes('fix')) complexity -= 0.5;

    return Math.max(0, Math.min(4, complexity));
  }

  /**
   * Generate execution plan for a task
   */
  private async generatePlan(task: Task): Promise<Plan> {
    // Placeholder implementation
    // TODO: Implement actual plan generation using PlanGenerator
    const approvalGates = this.configManager.getApprovalGates();
    const description = task.description.toLowerCase();

    // Determine if approval is required based on gates
    const triggeredGates: string[] = [];
    if (approvalGates.productionDeploy && description.includes('deploy')) {
      triggeredGates.push('productionDeploy');
    }
    if (approvalGates.databaseMigration && description.includes('migration')) {
      triggeredGates.push('databaseMigration');
    }
    if (approvalGates.securityChanges && description.includes('security')) {
      triggeredGates.push('securityChanges');
    }
    if (approvalGates.fileDeletion && description.includes('delete')) {
      triggeredGates.push('fileDeletion');
    }

    const plan: Plan = {
      id: uuidv4(),
      taskId: task.id,
      description: `Plan for: ${task.description}`,
      steps: [
        {
          id: uuidv4(),
          order: 1,
          description: 'Analyze requirements and context',
          agentType: AgentType.ARCHITECT,
          estimatedTokens: 1000,
          estimatedCost: 0.01,
          dependencies: [],
          status: TaskStatus.PENDING
        },
        {
          id: uuidv4(),
          order: 2,
          description: 'Implement changes',
          agentType: task.description.toLowerCase().includes('frontend')
            ? AgentType.FRONTEND
            : AgentType.BACKEND,
          estimatedTokens: 3000,
          estimatedCost: 0.03,
          dependencies: [],
          status: TaskStatus.PENDING
        },
        {
          id: uuidv4(),
          order: 3,
          description: 'Run tests and verify',
          agentType: AgentType.QA,
          estimatedTokens: 1000,
          estimatedCost: 0.01,
          dependencies: [],
          status: TaskStatus.PENDING
        }
      ],
      totalEstimatedTokens: 5000,
      totalEstimatedCost: 0.05,
      confidence: task.confidence || 0.5,
      confidenceTier: task.confidenceTier || ConfidenceTier.TIER_2,
      requiresApproval: triggeredGates.length > 0 || !this.configManager.isAutoApproveEnabled(),
      approvalGates: triggeredGates,
      createdAt: Date.now()
    };

    return plan;
  }

  /**
   * Execute the RARV cycle for a task
   */
  private async executeRARVCycle(task: Task, plan: Plan): Promise<void> {
    task.status = TaskStatus.IN_PROGRESS;
    task.startedAt = Date.now();

    // REASON phase
    this.stateManager.setPhase(RARVPhase.REASON);
    Logger.info('REASON phase: Analyzing task...');
    await this.delay(500); // Placeholder

    // ACT phase
    this.stateManager.setPhase(RARVPhase.ACT);
    Logger.info('ACT phase: Executing plan...');
    for (const step of plan.steps) {
      Logger.info(`Executing step ${step.order}: ${step.description}`);
      step.status = TaskStatus.IN_PROGRESS;
      await this.delay(500); // Placeholder
      step.status = TaskStatus.COMPLETED;
    }

    // REFLECT phase
    this.stateManager.setPhase(RARVPhase.REFLECT);
    Logger.info('REFLECT phase: Analyzing results...');
    await this.delay(500); // Placeholder

    // VERIFY phase
    this.stateManager.setPhase(RARVPhase.VERIFY);
    Logger.info('VERIFY phase: Running verification...');
    await this.delay(500); // Placeholder

    // Complete task
    task.status = TaskStatus.COMPLETED;
    task.completedAt = Date.now();
    task.cost = plan.totalEstimatedCost;
    task.result = {
      success: true,
      summary: `Completed task: ${task.description}`
    };

    this.stateManager.updateCost(task.cost);
    this.stateManager.completeTask(task);
    this.stateManager.stopExecution();

    Logger.info(`Task completed: ${task.id}`);
    vscode.window.showInformationMessage(`Task completed: ${task.description}`);

    // Process next task in queue
    await this.processNextTask();
  }

  /**
   * Process next task in queue
   */
  private async processNextTask(): Promise<void> {
    const nextTask = this.taskQueue.dequeue();
    if (nextTask) {
      this.stateManager.removeFromQueue(nextTask.id);
      Logger.info(`Processing next task from queue: ${nextTask.id}`);
      await this.executeTask(nextTask);
    }
  }

  /**
   * Stop current task execution
   */
  async stopTask(): Promise<void> {
    const state = this.stateManager.getState();
    if (!state.isRunning) {
      vscode.window.showInformationMessage('No task is currently running');
      return;
    }

    Logger.info('Stopping current task...');

    if (state.currentTask) {
      state.currentTask.status = TaskStatus.CANCELLED;
      this.stateManager.failTask(state.currentTask, 'Cancelled by user');
    }

    this.stateManager.stopExecution();
    vscode.window.showInformationMessage('Task stopped');
  }

  /**
   * Approve a pending plan
   */
  async approvePlan(planId?: string): Promise<void> {
    const state = this.stateManager.getState();
    const plan = state.pendingPlan;

    if (!plan || (planId && plan.id !== planId)) {
      vscode.window.showErrorMessage('No pending plan to approve');
      return;
    }

    Logger.info(`Plan approved: ${plan.id}`);
    this.stateManager.approvePlan();

    // Continue execution
    const task = state.currentTask;
    if (task) {
      await this.executeRARVCycle(task, plan);
    }
  }

  /**
   * Reject a pending plan
   */
  async rejectPlan(planId?: string): Promise<void> {
    const state = this.stateManager.getState();
    const plan = state.pendingPlan;

    if (!plan || (planId && plan.id !== planId)) {
      vscode.window.showErrorMessage('No pending plan to reject');
      return;
    }

    Logger.info(`Plan rejected: ${plan.id}`);
    this.stateManager.rejectPlan();

    // Cancel current task
    if (state.currentTask) {
      state.currentTask.status = TaskStatus.CANCELLED;
      this.stateManager.failTask(state.currentTask, 'Plan rejected by user');
    }

    this.stateManager.stopExecution();
    vscode.window.showInformationMessage('Plan rejected');

    // Process next task
    await this.processNextTask();
  }

  /**
   * Configure API keys
   */
  private async configureApiKeys(): Promise<void> {
    const providers = ['anthropic', 'openai', 'google'];
    const provider = await vscode.window.showQuickPick(providers, {
      placeHolder: 'Select provider to configure'
    });

    if (!provider) return;

    const apiKey = await vscode.window.showInputBox({
      prompt: `Enter API key for ${provider}`,
      password: true,
      ignoreFocusOut: true
    });

    if (apiKey) {
      await this.configManager.setApiKey(provider, apiKey);
      vscode.window.showInformationMessage(`API key configured for ${provider}`);
    }
  }

  /**
   * Show current status
   */
  private showStatus(): void {
    const state = this.stateManager.getState();
    const lines: string[] = [
      '=== Autonomi Status ===',
      `Running: ${state.isRunning}`,
      `Phase: ${state.phase || 'None'}`,
      `Session Cost: $${state.sessionCost.toFixed(2)}`,
      `Queue Size: ${state.taskQueue.length}`,
      `Active Agents: ${state.activeAgents.length}`,
      ''
    ];

    if (state.currentTask) {
      lines.push('Current Task:');
      lines.push(`  ID: ${state.currentTask.id}`);
      lines.push(`  Description: ${state.currentTask.description}`);
      lines.push(`  Status: ${state.currentTask.status}`);
      lines.push(`  Confidence: ${state.currentTask.confidence?.toFixed(2) || 'N/A'}`);
    }

    if (state.pendingPlan) {
      lines.push('');
      lines.push('Pending Plan:');
      lines.push(`  ID: ${state.pendingPlan.id}`);
      lines.push(`  Steps: ${state.pendingPlan.steps.length}`);
      lines.push(`  Est. Cost: $${state.pendingPlan.totalEstimatedCost.toFixed(2)}`);
      lines.push(`  Requires Approval: ${state.pendingPlan.requiresApproval}`);
    }

    this.outputChannel.clear();
    this.outputChannel.appendLine(lines.join('\n'));
    this.outputChannel.show();
  }

  /**
   * Clear task queue
   */
  private clearQueue(): void {
    this.taskQueue.clear();
    this.stateManager.setState({ taskQueue: [] });
    vscode.window.showInformationMessage('Task queue cleared');
  }

  /**
   * Get current execution state
   */
  getState(): ExecutionState {
    return this.stateManager.getState();
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    Logger.info('Disposing Autonomi extension...');

    // Dispose state manager
    this.stateManager.dispose();

    // Dispose all registered disposables
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];

    // Dispose optional components
    this.treeProvider?.dispose();
    this.statusBar?.dispose();
    this.orchestrator?.dispose();
    this.providerManager?.dispose();
    this.costTracker?.dispose();
    this.planGenerator?.dispose();
    this.approvalManager?.dispose();
    this.confidenceCalculator?.dispose();

    Logger.info('Autonomi extension disposed');
    Logger.dispose();
  }
}
