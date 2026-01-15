/**
 * Status bar controller for Autonomi Extension
 * Displays phase, confidence, and cost in the VSCode status bar
 */

import * as vscode from 'vscode';
import { RARVPhase, CostState } from '../types/execution';
import { ConfidenceTier } from '../providers/types';

// Status bar item priorities (higher = more left)
const PRIORITY_BASE = 100;
const PRIORITY_PHASE = PRIORITY_BASE + 2;
const PRIORITY_CONFIDENCE = PRIORITY_BASE + 1;
const PRIORITY_COST = PRIORITY_BASE;

// Phase display configuration
interface PhaseDisplay {
  text: string;
  icon: string;
  tooltip: string;
}

const PHASE_DISPLAYS: Record<RARVPhase, PhaseDisplay> = {
  idle: {
    text: 'Idle',
    icon: '$(circle-outline)',
    tooltip: 'Autonomi is idle - ready to accept tasks'
  },
  reason: {
    text: 'Reasoning',
    icon: '$(lightbulb)',
    tooltip: 'Autonomi is analyzing the task and planning approach'
  },
  act: {
    text: 'Acting',
    icon: '$(zap)',
    tooltip: 'Autonomi is executing the planned actions'
  },
  reflect: {
    text: 'Reflecting',
    icon: '$(eye)',
    tooltip: 'Autonomi is reviewing execution results'
  },
  verify: {
    text: 'Verifying',
    icon: '$(check)',
    tooltip: 'Autonomi is running verification checks'
  }
};

// Confidence tier display configuration
interface TierDisplay {
  color: string;
  label: string;
}

const TIER_DISPLAYS: Record<ConfidenceTier, TierDisplay> = {
  [ConfidenceTier.TIER_1]: { color: 'statusBarItem.prominentBackground', label: 'T1' },
  [ConfidenceTier.TIER_2]: { color: 'statusBarItem.warningBackground', label: 'T2' },
  [ConfidenceTier.TIER_3]: { color: 'statusBarItem.warningBackground', label: 'T3' },
  [ConfidenceTier.TIER_4]: { color: 'statusBarItem.errorBackground', label: 'T4' }
};

/**
 * Controller for status bar items
 */
export class StatusBarController {
  private phaseItem: vscode.StatusBarItem;
  private confidenceItem: vscode.StatusBarItem;
  private costItem: vscode.StatusBarItem;

  private currentPhase: RARVPhase = 'idle';
  private currentConfidence: number = 0;
  private currentTier: ConfidenceTier = ConfidenceTier.TIER_1;
  private currentCost: CostState = {
    sessionCost: 0,
    taskCost: 0,
    dailyCost: 0,
    budgetTask: 5.0,
    budgetSession: 50.0,
    budgetDaily: 100.0
  };
  private isRunning: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    // Create status bar items
    this.phaseItem = vscode.window.createStatusBarItem(
      'autonomi.phase',
      vscode.StatusBarAlignment.Left,
      PRIORITY_PHASE
    );
    this.phaseItem.name = 'Autonomi Phase';
    this.phaseItem.command = 'autonomi.showOutput';

    this.confidenceItem = vscode.window.createStatusBarItem(
      'autonomi.confidence',
      vscode.StatusBarAlignment.Left,
      PRIORITY_CONFIDENCE
    );
    this.confidenceItem.name = 'Autonomi Confidence';
    this.confidenceItem.command = 'autonomi.showConfidenceDetails';

    this.costItem = vscode.window.createStatusBarItem(
      'autonomi.cost',
      vscode.StatusBarAlignment.Left,
      PRIORITY_COST
    );
    this.costItem.name = 'Autonomi Cost';
    this.costItem.command = 'autonomi.showCostDetails';

    // Register disposables
    context.subscriptions.push(this.phaseItem);
    context.subscriptions.push(this.confidenceItem);
    context.subscriptions.push(this.costItem);

    // Initialize display
    this.updatePhaseDisplay();
    this.updateConfidenceDisplay();
    this.updateCostDisplay();

    // Show items
    this.phaseItem.show();
    this.confidenceItem.show();
    this.costItem.show();
  }

  /**
   * Update the phase display
   */
  updatePhase(phase: RARVPhase, isRunning: boolean = this.isRunning): void {
    this.currentPhase = phase;
    this.isRunning = isRunning;
    this.updatePhaseDisplay();
  }

  /**
   * Update the confidence display
   */
  updateConfidence(confidence: number, tier: ConfidenceTier): void {
    this.currentConfidence = confidence;
    this.currentTier = tier;
    this.updateConfidenceDisplay();
  }

  /**
   * Update the cost display
   */
  updateCost(cost: number | CostState): void {
    if (typeof cost === 'number') {
      this.currentCost = {
        ...this.currentCost,
        sessionCost: cost
      };
    } else {
      this.currentCost = cost;
    }
    this.updateCostDisplay();
  }

  /**
   * Set running state
   */
  setRunning(isRunning: boolean): void {
    this.isRunning = isRunning;
    this.updatePhaseDisplay();
  }

  /**
   * Update phase item display
   */
  private updatePhaseDisplay(): void {
    const display = PHASE_DISPLAYS[this.currentPhase];
    const runningIndicator = this.isRunning && this.currentPhase !== 'idle'
      ? '$(sync~spin) '
      : '';

    this.phaseItem.text = `${runningIndicator}${display.icon} Autonomi: ${display.text}`;
    this.phaseItem.tooltip = new vscode.MarkdownString(
      `**Autonomi Extension**\n\n${display.tooltip}\n\n` +
      `Click to show output channel`
    );

    // Update background for active states
    if (this.isRunning && this.currentPhase !== 'idle') {
      this.phaseItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.phaseItem.backgroundColor = undefined;
    }
  }

  /**
   * Update confidence item display
   */
  private updateConfidenceDisplay(): void {
    const percentage = Math.round(this.currentConfidence * 100);
    const tierDisplay = TIER_DISPLAYS[this.currentTier];

    this.confidenceItem.text = `$(dashboard) ${percentage}% [${tierDisplay.label}]`;

    // Build tooltip with tier explanation
    const tierExplanations: Record<ConfidenceTier, string> = {
      [ConfidenceTier.TIER_1]: 'Auto-execute (simple tasks)',
      [ConfidenceTier.TIER_2]: 'Execute with validation',
      [ConfidenceTier.TIER_3]: 'Execute with full review',
      [ConfidenceTier.TIER_4]: 'Requires human guidance'
    };

    this.confidenceItem.tooltip = new vscode.MarkdownString(
      `**Confidence Level**\n\n` +
      `- Score: ${percentage}%\n` +
      `- Tier: ${this.currentTier} - ${tierExplanations[this.currentTier]}\n\n` +
      `Click for confidence breakdown`
    );

    // Color based on tier
    if (this.currentTier === ConfidenceTier.TIER_4) {
      this.confidenceItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (this.currentTier === ConfidenceTier.TIER_3) {
      this.confidenceItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.confidenceItem.backgroundColor = undefined;
    }
  }

  /**
   * Update cost item display
   */
  private updateCostDisplay(): void {
    const sessionFormatted = this.formatCurrency(this.currentCost.sessionCost);
    const taskFormatted = this.formatCurrency(this.currentCost.taskCost);
    const dailyFormatted = this.formatCurrency(this.currentCost.dailyCost);

    // Calculate budget percentages
    const taskPercent = (this.currentCost.taskCost / this.currentCost.budgetTask) * 100;
    const sessionPercent = (this.currentCost.sessionCost / this.currentCost.budgetSession) * 100;
    const dailyPercent = (this.currentCost.dailyCost / this.currentCost.budgetDaily) * 100;

    // Determine warning state
    const isWarning = taskPercent >= 80 || sessionPercent >= 80 || dailyPercent >= 80;
    const isError = taskPercent >= 100 || sessionPercent >= 100 || dailyPercent >= 100;

    // Set display text
    this.costItem.text = `$(credit-card) ${sessionFormatted}`;

    // Build tooltip
    this.costItem.tooltip = new vscode.MarkdownString(
      `**Cost Tracking**\n\n` +
      `| Scope | Current | Budget | Used |\n` +
      `|-------|---------|--------|------|\n` +
      `| Task | ${taskFormatted} | ${this.formatCurrency(this.currentCost.budgetTask)} | ${taskPercent.toFixed(0)}% |\n` +
      `| Session | ${sessionFormatted} | ${this.formatCurrency(this.currentCost.budgetSession)} | ${sessionPercent.toFixed(0)}% |\n` +
      `| Daily | ${dailyFormatted} | ${this.formatCurrency(this.currentCost.budgetDaily)} | ${dailyPercent.toFixed(0)}% |\n\n` +
      `Click for detailed breakdown`
    );

    // Set background based on budget status
    if (isError) {
      this.costItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (isWarning) {
      this.costItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.costItem.backgroundColor = undefined;
    }
  }

  /**
   * Format currency value
   */
  private formatCurrency(value: number): string {
    if (value < 0.01) {
      return `$${value.toFixed(4)}`;
    } else if (value < 1) {
      return `$${value.toFixed(3)}`;
    } else {
      return `$${value.toFixed(2)}`;
    }
  }

  /**
   * Show all status bar items
   */
  show(): void {
    this.phaseItem.show();
    this.confidenceItem.show();
    this.costItem.show();
  }

  /**
   * Hide all status bar items
   */
  hide(): void {
    this.phaseItem.hide();
    this.confidenceItem.hide();
    this.costItem.hide();
  }

  /**
   * Reset to default state
   */
  reset(): void {
    this.currentPhase = 'idle';
    this.currentConfidence = 0;
    this.currentTier = ConfidenceTier.TIER_1;
    this.currentCost = {
      sessionCost: 0,
      taskCost: 0,
      dailyCost: 0,
      budgetTask: 5.0,
      budgetSession: 50.0,
      budgetDaily: 100.0
    };
    this.isRunning = false;

    this.updatePhaseDisplay();
    this.updateConfidenceDisplay();
    this.updateCostDisplay();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.phaseItem.dispose();
    this.confidenceItem.dispose();
    this.costItem.dispose();
  }
}
