/**
 * Quick pick dialogs for Autonomi Extension
 * Provides task input, plan approval, and agent selection interfaces
 */

import * as vscode from 'vscode';
import { Plan, PlanStep, AgentType } from '../types/execution';

// Agent type descriptions for selection
const AGENT_DESCRIPTIONS: Record<AgentType, string> = {
  // Engineering
  frontend: 'React, Vue, Angular, CSS, HTML',
  backend: 'Node, Python, Go, Java, APIs',
  database: 'SQL, migrations, schema design',
  api: 'REST, GraphQL, OpenAPI spec',
  devops: 'CI/CD, Docker, Kubernetes, IaC',
  qa: 'Test strategy, E2E, integration',
  // Quality
  code_review: 'Code quality, patterns, maintainability',
  security_review: 'Vulnerabilities, secrets, OWASP',
  test_gen: 'Unit test generation, coverage',
  perf: 'Performance analysis, optimization',
  // Support
  docs: 'Documentation, README, API docs',
  refactor: 'Code cleanup, modernization',
  migration: 'Language/framework upgrades',
  // Planning
  architect: 'System design, architecture decisions',
  decomposition: 'Break complex tasks into subtasks'
};

// Agent type categories
const AGENT_CATEGORIES: Record<string, AgentType[]> = {
  Engineering: ['frontend', 'backend', 'database', 'api', 'devops', 'qa'],
  Quality: ['code_review', 'security_review', 'test_gen', 'perf'],
  Support: ['docs', 'refactor', 'migration'],
  Planning: ['architect', 'decomposition']
};

/**
 * Show task input dialog
 * @returns Task description or undefined if cancelled
 */
export async function showTaskInput(): Promise<string | undefined> {
  const result = await vscode.window.showInputBox({
    title: 'Autonomi - New Task',
    prompt: 'Describe the task you want to accomplish',
    placeHolder: 'e.g., Add a new REST endpoint for user authentication',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Please enter a task description';
      }
      if (value.length < 10) {
        return 'Please provide more detail (at least 10 characters)';
      }
      return undefined;
    }
  });

  return result?.trim();
}

/**
 * Show multi-line task input using an input box with additional context
 * @returns Task description or undefined if cancelled
 */
export async function showDetailedTaskInput(): Promise<{
  title: string;
  description: string;
} | undefined> {
  // First, get the task title
  const title = await vscode.window.showInputBox({
    title: 'Autonomi - New Task (1/2)',
    prompt: 'Enter a brief title for this task',
    placeHolder: 'e.g., Add user authentication endpoint',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'Please enter a task title';
      }
      return undefined;
    }
  });

  if (!title) {
    return undefined;
  }

  // Then, get the detailed description
  const description = await vscode.window.showInputBox({
    title: 'Autonomi - New Task (2/2)',
    prompt: 'Enter detailed requirements (optional - press Enter to skip)',
    placeHolder: 'Additional context, constraints, or requirements...',
    ignoreFocusOut: true
  });

  return {
    title: title.trim(),
    description: description?.trim() || title.trim()
  };
}

/**
 * Plan step quick pick item
 */
interface PlanStepItem extends vscode.QuickPickItem {
  step: PlanStep;
}

/**
 * Show plan approval dialog
 * @param plan The execution plan to approve
 * @returns true if approved, false if rejected
 */
export async function showPlanApproval(plan: Plan): Promise<boolean> {
  // Create quick pick items for plan steps
  const stepItems: PlanStepItem[] = plan.steps.map((step, index) => ({
    label: `${index + 1}. ${step.description}`,
    description: formatAgentType(step.agentType),
    detail: `Files: ${step.filesAffected.join(', ') || 'None'} | Est. cost: $${step.estimatedCost.toFixed(4)}`,
    step
  }));

  // Add summary header
  const summaryItem: vscode.QuickPickItem = {
    label: `Plan: ${plan.title}`,
    description: `${plan.steps.length} steps`,
    detail: `Total est. cost: $${plan.totalEstimatedCost.toFixed(4)} | Est. duration: ${formatDuration(plan.totalEstimatedDuration)}`,
    kind: vscode.QuickPickItemKind.Separator
  };

  // Add action items
  const approveItem: vscode.QuickPickItem = {
    label: '$(check) Approve Plan',
    description: 'Execute this plan',
    alwaysShow: true
  };

  const rejectItem: vscode.QuickPickItem = {
    label: '$(x) Reject Plan',
    description: 'Cancel and provide new instructions',
    alwaysShow: true
  };

  const modifyItem: vscode.QuickPickItem = {
    label: '$(edit) Modify Plan',
    description: 'Edit the task description',
    alwaysShow: true
  };

  const items: vscode.QuickPickItem[] = [
    summaryItem,
    ...stepItems,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    approveItem,
    modifyItem,
    rejectItem
  ];

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Autonomi - Review Execution Plan',
    placeHolder: 'Review the plan and choose an action',
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });

  if (!selected) {
    return false;
  }

  if (selected === approveItem) {
    return true;
  }

  if (selected === modifyItem) {
    // Allow user to modify the task
    const newTask = await showTaskInput();
    if (newTask) {
      // Signal that we need to regenerate the plan
      // This is handled by the caller
      vscode.commands.executeCommand('autonomi.plan', newTask);
    }
    return false;
  }

  return false;
}

/**
 * Show detailed plan view in a webview or quick pick
 */
export async function showPlanDetails(plan: Plan): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'autonomiPlanView',
    `Plan: ${plan.title}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: false
    }
  );

  panel.webview.html = generatePlanHtml(plan);
}

/**
 * Generate HTML for plan details view
 */
function generatePlanHtml(plan: Plan): string {
  const stepsHtml = plan.steps.map((step, index) => `
    <div class="step">
      <div class="step-header">
        <span class="step-number">${index + 1}</span>
        <span class="step-title">${escapeHtml(step.description)}</span>
      </div>
      <div class="step-details">
        <span class="agent-badge">${formatAgentType(step.agentType)}</span>
        <span class="cost">Est. $${step.estimatedCost.toFixed(4)}</span>
      </div>
      <div class="files">
        ${step.filesAffected.length > 0
          ? `Files: ${step.filesAffected.map(f => `<code>${escapeHtml(f)}</code>`).join(', ')}`
          : 'No files affected'}
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1 {
      font-size: 1.4em;
      margin-bottom: 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .summary {
      display: flex;
      gap: 20px;
      margin-bottom: 20px;
      padding: 10px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
    }
    .summary-item {
      display: flex;
      flex-direction: column;
    }
    .summary-label {
      font-size: 0.8em;
      opacity: 0.7;
    }
    .summary-value {
      font-size: 1.1em;
      font-weight: bold;
    }
    .step {
      margin-bottom: 15px;
      padding: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
    }
    .step-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .step-number {
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8em;
      font-weight: bold;
    }
    .step-title {
      font-weight: 500;
    }
    .step-details {
      display: flex;
      gap: 10px;
      margin-bottom: 8px;
    }
    .agent-badge {
      background-color: var(--vscode-textLink-foreground);
      color: var(--vscode-editor-background);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.8em;
    }
    .cost {
      opacity: 0.7;
      font-size: 0.9em;
    }
    .files {
      font-size: 0.85em;
      opacity: 0.8;
    }
    .files code {
      background-color: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 2px;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(plan.title)}</h1>
  <div class="summary">
    <div class="summary-item">
      <span class="summary-label">Steps</span>
      <span class="summary-value">${plan.steps.length}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Est. Cost</span>
      <span class="summary-value">$${plan.totalEstimatedCost.toFixed(4)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Est. Duration</span>
      <span class="summary-value">${formatDuration(plan.totalEstimatedDuration)}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Est. Tokens</span>
      <span class="summary-value">${plan.totalEstimatedTokens.toLocaleString()}</span>
    </div>
  </div>
  <div class="steps">
    ${stepsHtml}
  </div>
</body>
</html>`;
}

/**
 * Show agent selection dialog
 * @returns Selected agent type or undefined if cancelled
 */
export async function showAgentSelection(): Promise<AgentType | undefined> {
  interface AgentQuickPickItem extends vscode.QuickPickItem {
    agentType?: AgentType;
  }

  const items: AgentQuickPickItem[] = [];

  // Build items by category
  for (const [category, agents] of Object.entries(AGENT_CATEGORIES)) {
    // Add category separator
    items.push({
      label: category,
      kind: vscode.QuickPickItemKind.Separator
    });

    // Add agents in this category
    for (const agentType of agents) {
      items.push({
        label: formatAgentType(agentType),
        description: AGENT_DESCRIPTIONS[agentType],
        agentType
      });
    }
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'Autonomi - Select Agent Type',
    placeHolder: 'Choose the type of agent for this task',
    matchOnDescription: true
  });

  return selected?.agentType;
}

/**
 * Show confirmation dialog
 */
export async function showConfirmation(
  message: string,
  confirmLabel: string = 'Confirm',
  cancelLabel: string = 'Cancel'
): Promise<boolean> {
  const result = await vscode.window.showWarningMessage(
    message,
    { modal: true },
    confirmLabel,
    cancelLabel
  );

  return result === confirmLabel;
}

/**
 * Show model selection for a task
 */
export async function showModelSelection(): Promise<string | undefined> {
  const models = [
    { label: 'Claude Opus', description: 'Most capable, best for complex tasks', value: 'claude-opus-4-20250514' },
    { label: 'Claude Sonnet', description: 'Balanced performance and cost', value: 'claude-sonnet-4-20250514' },
    { label: 'Claude Haiku', description: 'Fast and cost-effective', value: 'claude-haiku-3-20250307' },
    { label: 'GPT-4o', description: 'OpenAI flagship model', value: 'gpt-4o' },
    { label: 'GPT-4 Turbo', description: 'OpenAI fast model', value: 'gpt-4-turbo' },
    { label: 'Gemini Pro', description: 'Google flagship model', value: 'gemini-pro' }
  ];

  const selected = await vscode.window.showQuickPick(
    models.map(m => ({ label: m.label, description: m.description, value: m.value })),
    {
      title: 'Autonomi - Select Model',
      placeHolder: 'Choose the model for this task'
    }
  );

  return (selected as { value: string } | undefined)?.value;
}

// Utility functions

function formatAgentType(type: AgentType): string {
  return type
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
