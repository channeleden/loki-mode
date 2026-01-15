/**
 * Main TreeView data provider for Autonomi Extension
 * Displays status, queue, and action items in the sidebar
 */

import * as vscode from 'vscode';
import {
  AutonomiTreeItem,
  StatusItem,
  QueueCategoryItem,
  TaskItem,
  ActionItem,
  AgentItem
} from './tree-items';
import { ExecutionState, Task } from '../../types/execution';
import { ConfidenceTier } from '../../providers/types';

// Root section types
type RootSection = 'status' | 'queue' | 'agents' | 'actions';

// Root section item for collapsible sections
class RootSectionItem extends vscode.TreeItem {
  constructor(
    public readonly section: RootSection,
    label: string,
    expanded: boolean = true
  ) {
    super(
      label,
      expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = `section_${section}`;
    this.iconPath = this.getIcon();
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.section) {
      case 'status':
        return new vscode.ThemeIcon('info');
      case 'queue':
        return new vscode.ThemeIcon('tasklist');
      case 'agents':
        return new vscode.ThemeIcon('server-process');
      case 'actions':
        return new vscode.ThemeIcon('run-all');
    }
  }
}

// Tree item union type
type TreeItem = RootSectionItem | AutonomiTreeItem | QueueCategoryItem;

/**
 * TreeView data provider for the Autonomi sidebar panel
 */
export class AutonomiTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

  private state: ExecutionState;
  private refreshDebounceTimer: NodeJS.Timeout | undefined;
  private readonly REFRESH_DEBOUNCE_MS = 100;

  constructor() {
    this.state = this.createDefaultState();
  }

  /**
   * Create default execution state
   */
  private createDefaultState(): ExecutionState {
    return {
      phase: 'idle',
      isRunning: false,
      isPaused: false,
      activeAgents: [],
      queue: {
        pending: [],
        inProgress: [],
        completed: [],
        failed: []
      },
      confidence: 0,
      confidenceTier: ConfidenceTier.TIER_1,
      cost: {
        sessionCost: 0,
        taskCost: 0,
        dailyCost: 0,
        budgetTask: 5.0,
        budgetSession: 50.0,
        budgetDaily: 100.0
      },
      sessionId: '',
      sessionStartedAt: 0,
      lastUpdatedAt: Date.now()
    };
  }

  /**
   * Get tree item for display
   */
  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children for a tree item
   */
  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    // Root level - return sections
    if (!element) {
      return Promise.resolve(this.getRootSections());
    }

    // Section children
    if (element instanceof RootSectionItem) {
      return Promise.resolve(this.getSectionChildren(element.section));
    }

    // Queue category children
    if (element instanceof QueueCategoryItem) {
      return Promise.resolve(this.getQueueCategoryChildren(element.category));
    }

    return Promise.resolve([]);
  }

  /**
   * Get root level sections
   */
  private getRootSections(): RootSectionItem[] {
    return [
      new RootSectionItem('status', 'Status', true),
      new RootSectionItem('queue', 'Task Queue', true),
      new RootSectionItem('agents', 'Active Agents', this.state.activeAgents.length > 0),
      new RootSectionItem('actions', 'Actions', true)
    ];
  }

  /**
   * Get children for a root section
   */
  private getSectionChildren(section: RootSection): AutonomiTreeItem[] {
    switch (section) {
      case 'status':
        return this.getStatusItems();
      case 'queue':
        return this.getQueueCategories();
      case 'agents':
        return this.getAgentItems();
      case 'actions':
        return this.getActionItems();
    }
  }

  /**
   * Get status display items
   */
  private getStatusItems(): StatusItem[] {
    return [
      StatusItem.createPhaseItem(this.state.phase, this.state.isRunning),
      StatusItem.createAgentsItem(this.state.activeAgents),
      StatusItem.createConfidenceItem(this.state.confidence, this.state.confidenceTier),
      StatusItem.createCostItem(this.state.cost.sessionCost, this.state.cost.taskCost)
    ];
  }

  /**
   * Get queue category items
   */
  private getQueueCategories(): QueueCategoryItem[] {
    return [
      new QueueCategoryItem('in_progress', this.state.queue.inProgress.length),
      new QueueCategoryItem('pending', this.state.queue.pending.length),
      new QueueCategoryItem('completed', this.state.queue.completed.length),
      new QueueCategoryItem('failed', this.state.queue.failed.length)
    ];
  }

  /**
   * Get tasks for a queue category
   */
  private getQueueCategoryChildren(category: 'pending' | 'in_progress' | 'completed' | 'failed'): TaskItem[] {
    let tasks: Task[];
    switch (category) {
      case 'pending':
        tasks = this.state.queue.pending;
        break;
      case 'in_progress':
        tasks = this.state.queue.inProgress;
        break;
      case 'completed':
        // Limit completed tasks to last 10
        tasks = this.state.queue.completed.slice(-10);
        break;
      case 'failed':
        tasks = this.state.queue.failed;
        break;
    }
    return tasks.map(task => new TaskItem(task));
  }

  /**
   * Get active agent items
   */
  private getAgentItems(): AgentItem[] {
    return this.state.activeAgents.map(agent => new AgentItem(agent));
  }

  /**
   * Get action items based on current state
   */
  private getActionItems(): ActionItem[] {
    const items: ActionItem[] = [];

    // Pause/Resume based on state
    if (this.state.isRunning) {
      if (this.state.isPaused) {
        items.push(ActionItem.createResumeAction());
      } else {
        items.push(ActionItem.createPauseAction());
      }
      items.push(ActionItem.createStopAction());
    }

    // View plan if available
    if (this.state.currentPlan) {
      items.push(ActionItem.createViewPlanAction());
    }

    // Always show dashboard and configure
    items.push(ActionItem.createDashboardAction());
    items.push(ActionItem.createConfigureAction());

    return items;
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    // Debounce rapid updates
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this.refreshDebounceTimer = setTimeout(() => {
      this._onDidChangeTreeData.fire();
      this.refreshDebounceTimer = undefined;
    }, this.REFRESH_DEBOUNCE_MS);
  }

  /**
   * Force immediate refresh without debouncing
   */
  refreshImmediate(): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = undefined;
    }
    this._onDidChangeTreeData.fire();
  }

  /**
   * Update the execution state and refresh view
   */
  updateState(state: ExecutionState): void {
    this.state = state;
    this.refresh();
  }

  /**
   * Partially update state (merges with existing)
   */
  updatePartialState(partialState: Partial<ExecutionState>): void {
    this.state = {
      ...this.state,
      ...partialState,
      lastUpdatedAt: Date.now()
    };
    this.refresh();
  }

  /**
   * Get current state (for external access)
   */
  getState(): ExecutionState {
    return this.state;
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.state = this.createDefaultState();
    this.refreshImmediate();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.refreshDebounceTimer) {
      clearTimeout(this.refreshDebounceTimer);
    }
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Register the TreeView with VSCode
 */
export function registerTreeView(context: vscode.ExtensionContext): AutonomiTreeProvider {
  const provider = new AutonomiTreeProvider();

  const treeView = vscode.window.createTreeView('autonomiPanel', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: false
  });

  context.subscriptions.push(treeView);
  context.subscriptions.push({
    dispose: () => provider.dispose()
  });

  return provider;
}
