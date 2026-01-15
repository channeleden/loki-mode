/**
 * TreeView item definitions for Autonomi Extension
 * Defines the visual elements displayed in the sidebar TreeView
 */

import * as vscode from 'vscode';
import { RARVPhase, Task, TaskStatus, ActiveAgent, AgentType, QueueState } from '../../types/execution';
import { ConfidenceTier } from '../../providers/types';

// Base tree item type for Autonomi
export type TreeItemType =
  | 'status'
  | 'queue'
  | 'action'
  | 'task'
  | 'agent'
  | 'category';

// Base class for all tree items
export abstract class AutonomiTreeItem extends vscode.TreeItem {
  abstract readonly itemType: TreeItemType;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(label, collapsibleState);
  }
}

// Status item - shows current phase, agents, confidence, cost
export class StatusItem extends AutonomiTreeItem {
  readonly itemType: TreeItemType = 'status';

  constructor(
    public readonly statusType: 'phase' | 'agents' | 'confidence' | 'cost',
    label: string,
    description?: string,
    tooltip?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = `status_${statusType}`;
    this.iconPath = this.getIcon();
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.statusType) {
      case 'phase':
        return new vscode.ThemeIcon('pulse');
      case 'agents':
        return new vscode.ThemeIcon('server-process');
      case 'confidence':
        return new vscode.ThemeIcon('dashboard');
      case 'cost':
        return new vscode.ThemeIcon('credit-card');
    }
  }

  static createPhaseItem(phase: RARVPhase, isRunning: boolean): StatusItem {
    const phaseLabels: Record<RARVPhase, string> = {
      idle: 'Idle',
      reason: 'Reasoning',
      act: 'Acting',
      reflect: 'Reflecting',
      verify: 'Verifying'
    };
    const label = phaseLabels[phase];
    const description = isRunning ? 'Running' : 'Stopped';
    return new StatusItem('phase', `Phase: ${label}`, description);
  }

  static createAgentsItem(activeAgents: ActiveAgent[]): StatusItem {
    const count = activeAgents.length;
    const description = count > 0
      ? activeAgents.map(a => a.type).join(', ')
      : 'None active';
    return new StatusItem('agents', `Active Agents: ${count}`, description);
  }

  static createConfidenceItem(confidence: number, tier: ConfidenceTier): StatusItem {
    const percentage = Math.round(confidence * 100);
    const tierLabel = `Tier ${tier}`;
    return new StatusItem(
      'confidence',
      `Confidence: ${percentage}%`,
      tierLabel,
      `Confidence score: ${percentage}%\nRouting tier: ${tierLabel}`
    );
  }

  static createCostItem(sessionCost: number, taskCost: number): StatusItem {
    const formattedSession = `$${sessionCost.toFixed(4)}`;
    const formattedTask = `$${taskCost.toFixed(4)}`;
    return new StatusItem(
      'cost',
      `Cost: ${formattedSession}`,
      `Task: ${formattedTask}`,
      `Session cost: ${formattedSession}\nCurrent task: ${formattedTask}`
    );
  }
}

// Queue category item - shows pending, in-progress, completed sections
export class QueueCategoryItem extends AutonomiTreeItem {
  readonly itemType: TreeItemType = 'category';

  constructor(
    public readonly category: 'pending' | 'in_progress' | 'completed' | 'failed',
    count: number
  ) {
    const labels: Record<string, string> = {
      pending: 'Pending',
      in_progress: 'In Progress',
      completed: 'Completed',
      failed: 'Failed'
    };
    super(
      labels[category],
      count > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.description = `(${count})`;
    this.contextValue = `queue_${category}`;
    this.iconPath = this.getIcon();
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.category) {
      case 'pending':
        return new vscode.ThemeIcon('clock');
      case 'in_progress':
        return new vscode.ThemeIcon('sync~spin');
      case 'completed':
        return new vscode.ThemeIcon('check');
      case 'failed':
        return new vscode.ThemeIcon('error');
    }
  }
}

// Individual task item
export class TaskItem extends AutonomiTreeItem {
  readonly itemType: TreeItemType = 'task';

  constructor(
    public readonly task: Task
  ) {
    super(task.title, vscode.TreeItemCollapsibleState.None);
    this.description = this.getStatusDescription();
    this.tooltip = this.buildTooltip();
    this.contextValue = `task_${task.status}`;
    this.iconPath = this.getStatusIcon();

    // Make in-progress tasks clickable to show details
    if (task.status === 'in_progress') {
      this.command = {
        command: 'autonomi.showTaskDetails',
        title: 'Show Task Details',
        arguments: [task.id]
      };
    }
  }

  private getStatusDescription(): string {
    const agentLabel = this.task.agentType
      ? `[${this.formatAgentType(this.task.agentType)}]`
      : '';

    switch (this.task.status) {
      case 'pending':
        return `${agentLabel} Queued`;
      case 'in_progress':
        return `${agentLabel} Running...`;
      case 'completed':
        return `${agentLabel} Done`;
      case 'failed':
        return `${agentLabel} Failed`;
      case 'paused':
        return `${agentLabel} Paused`;
      case 'cancelled':
        return `${agentLabel} Cancelled`;
    }
  }

  private formatAgentType(type: AgentType): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private getStatusIcon(): vscode.ThemeIcon {
    switch (this.task.status) {
      case 'pending':
        return new vscode.ThemeIcon('circle-outline');
      case 'in_progress':
        return new vscode.ThemeIcon('loading~spin');
      case 'completed':
        return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      case 'failed':
        return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
      case 'paused':
        return new vscode.ThemeIcon('debug-pause');
      case 'cancelled':
        return new vscode.ThemeIcon('circle-slash');
    }
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${this.task.title}**\n\n`);
    md.appendMarkdown(`${this.task.description}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`- **Status:** ${this.task.status}\n`);
    if (this.task.agentType) {
      md.appendMarkdown(`- **Agent:** ${this.formatAgentType(this.task.agentType)}\n`);
    }
    if (this.task.confidence !== undefined) {
      md.appendMarkdown(`- **Confidence:** ${Math.round(this.task.confidence * 100)}%\n`);
    }
    if (this.task.priority !== undefined) {
      md.appendMarkdown(`- **Priority:** ${this.task.priority}\n`);
    }
    const created = new Date(this.task.createdAt).toLocaleTimeString();
    md.appendMarkdown(`- **Created:** ${created}\n`);
    if (this.task.startedAt) {
      const started = new Date(this.task.startedAt).toLocaleTimeString();
      md.appendMarkdown(`- **Started:** ${started}\n`);
    }
    if (this.task.completedAt) {
      const completed = new Date(this.task.completedAt).toLocaleTimeString();
      md.appendMarkdown(`- **Completed:** ${completed}\n`);
    }
    return md;
  }
}

// Action item - buttons for pause/resume, view plan, etc.
export class ActionItem extends AutonomiTreeItem {
  readonly itemType: TreeItemType = 'action';

  constructor(
    public readonly actionType: 'pause' | 'resume' | 'stop' | 'viewPlan' | 'dashboard' | 'configure',
    label: string,
    command: vscode.Command
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = command;
    this.contextValue = `action_${actionType}`;
    this.iconPath = this.getIcon();
  }

  private getIcon(): vscode.ThemeIcon {
    switch (this.actionType) {
      case 'pause':
        return new vscode.ThemeIcon('debug-pause');
      case 'resume':
        return new vscode.ThemeIcon('debug-start');
      case 'stop':
        return new vscode.ThemeIcon('debug-stop');
      case 'viewPlan':
        return new vscode.ThemeIcon('list-tree');
      case 'dashboard':
        return new vscode.ThemeIcon('dashboard');
      case 'configure':
        return new vscode.ThemeIcon('gear');
    }
  }

  static createPauseAction(): ActionItem {
    return new ActionItem('pause', 'Pause Execution', {
      command: 'autonomi.pause',
      title: 'Pause Execution'
    });
  }

  static createResumeAction(): ActionItem {
    return new ActionItem('resume', 'Resume Execution', {
      command: 'autonomi.resume',
      title: 'Resume Execution'
    });
  }

  static createStopAction(): ActionItem {
    return new ActionItem('stop', 'Stop Execution', {
      command: 'autonomi.stop',
      title: 'Stop Execution'
    });
  }

  static createViewPlanAction(): ActionItem {
    return new ActionItem('viewPlan', 'View Current Plan', {
      command: 'autonomi.viewPlan',
      title: 'View Current Plan'
    });
  }

  static createDashboardAction(): ActionItem {
    return new ActionItem('dashboard', 'Open Dashboard', {
      command: 'autonomi.openDashboard',
      title: 'Open Dashboard'
    });
  }

  static createConfigureAction(): ActionItem {
    return new ActionItem('configure', 'Configure Settings', {
      command: 'autonomi.configure',
      title: 'Configure Settings'
    });
  }
}

// Agent item - shows active agent details
export class AgentItem extends AutonomiTreeItem {
  readonly itemType: TreeItemType = 'agent';

  constructor(
    public readonly agent: ActiveAgent
  ) {
    const label = AgentItem.formatAgentType(agent.type);
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = this.getProgressDescription();
    this.tooltip = this.buildTooltip();
    this.contextValue = 'agent';
    this.iconPath = new vscode.ThemeIcon('hubot');
  }

  private static formatAgentType(type: AgentType): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private getProgressDescription(): string {
    if (this.agent.progress !== undefined) {
      return `${Math.round(this.agent.progress * 100)}%`;
    }
    if (this.agent.currentStep) {
      return this.agent.currentStep;
    }
    return 'Working...';
  }

  private buildTooltip(): string {
    const elapsed = Date.now() - this.agent.startedAt;
    const seconds = Math.floor(elapsed / 1000);
    return `Agent: ${AgentItem.formatAgentType(this.agent.type)}\nTask: ${this.agent.taskId}\nElapsed: ${seconds}s`;
  }
}
