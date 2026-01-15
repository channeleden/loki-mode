/**
 * Output channel for Autonomi Extension
 * Handles streaming output, thinking blocks, and logging
 */

import * as vscode from 'vscode';

// Log level for filtering output
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

// Log entry structure
interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  message: string;
  source?: string;
}

/**
 * Output channel manager for streaming and logging
 */
export class AutonomiOutputChannel {
  private channel: vscode.OutputChannel;
  private logLevel: LogLevel;
  private isStreaming: boolean = false;
  private streamBuffer: string = '';
  private readonly STREAM_FLUSH_INTERVAL = 50; // ms
  private streamFlushTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext, logLevel: LogLevel = LogLevel.INFO) {
    this.channel = vscode.window.createOutputChannel('Autonomi', { log: true });
    this.logLevel = logLevel;

    context.subscriptions.push(this.channel);
  }

  /**
   * Log a message at specified level
   */
  private logWithLevel(level: LogLevel, message: string, source?: string): void {
    if (level < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelStr = LogLevel[level].padEnd(5);
    const sourceStr = source ? `[${source}] ` : '';
    const formattedMessage = `[${timestamp}] ${levelStr} ${sourceStr}${message}`;

    this.channel.appendLine(formattedMessage);
  }

  /**
   * Log debug message
   */
  debug(message: string, source?: string): void {
    this.logWithLevel(LogLevel.DEBUG, message, source);
  }

  /**
   * Log info message
   */
  info(message: string, source?: string): void {
    this.logWithLevel(LogLevel.INFO, message, source);
  }

  /**
   * Log warning message
   */
  warn(message: string, source?: string): void {
    this.logWithLevel(LogLevel.WARN, message, source);
  }

  /**
   * Log error message
   */
  error(message: string, source?: string): void {
    this.logWithLevel(LogLevel.ERROR, message, source);
  }

  /**
   * General log method (defaults to INFO)
   */
  log(message: string, source?: string): void {
    this.info(message, source);
  }

  /**
   * Start streaming mode for token-by-token output
   */
  startStreaming(label?: string): void {
    if (this.isStreaming) {
      this.endStreaming();
    }

    this.isStreaming = true;
    this.streamBuffer = '';

    if (label) {
      this.channel.appendLine('');
      this.channel.appendLine(`--- ${label} ---`);
    }
  }

  /**
   * Stream a single token
   */
  streamToken(token: string): void {
    if (!this.isStreaming) {
      this.startStreaming();
    }

    this.streamBuffer += token;

    // Debounce flushing for performance
    if (!this.streamFlushTimer) {
      this.streamFlushTimer = setTimeout(() => {
        this.flushStreamBuffer();
        this.streamFlushTimer = undefined;
      }, this.STREAM_FLUSH_INTERVAL);
    }
  }

  /**
   * Flush the stream buffer to output
   */
  private flushStreamBuffer(): void {
    if (this.streamBuffer.length > 0) {
      this.channel.append(this.streamBuffer);
      this.streamBuffer = '';
    }
  }

  /**
   * End streaming mode
   */
  endStreaming(): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = undefined;
    }

    this.flushStreamBuffer();
    this.isStreaming = false;
    this.channel.appendLine('');
  }

  /**
   * Show extended thinking block (for Claude's thinking output)
   */
  showThinking(thinking: string): void {
    this.channel.appendLine('');
    this.channel.appendLine('=== Extended Thinking ===');
    this.channel.appendLine('');

    // Format thinking content with indentation
    const lines = thinking.split('\n');
    for (const line of lines) {
      this.channel.appendLine(`  ${line}`);
    }

    this.channel.appendLine('');
    this.channel.appendLine('=== End Thinking ===');
    this.channel.appendLine('');
  }

  /**
   * Show a code block in output
   */
  showCode(code: string, language?: string): void {
    this.channel.appendLine('');
    this.channel.appendLine(`--- Code${language ? ` (${language})` : ''} ---`);
    this.channel.appendLine(code);
    this.channel.appendLine('--- End Code ---');
    this.channel.appendLine('');
  }

  /**
   * Show execution result
   */
  showResult(success: boolean, message: string, details?: string): void {
    const statusIcon = success ? '[OK]' : '[FAIL]';
    this.channel.appendLine('');
    this.channel.appendLine(`${statusIcon} ${message}`);
    if (details) {
      this.channel.appendLine(`     ${details}`);
    }
  }

  /**
   * Show a separator line
   */
  showSeparator(label?: string): void {
    const line = '='.repeat(60);
    this.channel.appendLine('');
    if (label) {
      const padding = Math.max(0, Math.floor((60 - label.length - 2) / 2));
      const paddedLabel = ' '.repeat(padding) + ` ${label} ` + ' '.repeat(padding);
      this.channel.appendLine(paddedLabel.substring(0, 60));
    }
    this.channel.appendLine(line);
  }

  /**
   * Show task start
   */
  showTaskStart(taskId: string, title: string): void {
    this.showSeparator(`Task: ${taskId}`);
    this.info(`Starting: ${title}`, 'Task');
  }

  /**
   * Show task completion
   */
  showTaskComplete(taskId: string, success: boolean, duration: number): void {
    const status = success ? 'completed successfully' : 'failed';
    this.info(`Task ${taskId} ${status} in ${duration}ms`, 'Task');
    this.channel.appendLine('');
  }

  /**
   * Show phase transition
   */
  showPhaseTransition(from: string, to: string): void {
    this.info(`Phase transition: ${from} -> ${to}`, 'RARV');
  }

  /**
   * Show agent activity
   */
  showAgentActivity(agentType: string, action: string): void {
    this.info(`[${agentType}] ${action}`, 'Agent');
  }

  /**
   * Show cost update
   */
  showCostUpdate(tokens: { input: number; output: number }, cost: number): void {
    this.debug(
      `Tokens: ${tokens.input} in, ${tokens.output} out | Cost: $${cost.toFixed(4)}`,
      'Cost'
    );
  }

  /**
   * Clear the output channel
   */
  clear(): void {
    this.channel.clear();
  }

  /**
   * Show the output channel
   */
  show(preserveFocus: boolean = true): void {
    this.channel.show(preserveFocus);
  }

  /**
   * Hide the output channel
   */
  hide(): void {
    this.channel.hide();
  }

  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Get the underlying VSCode output channel
   */
  getChannel(): vscode.OutputChannel {
    return this.channel;
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
    }
    this.channel.dispose();
  }
}

/**
 * Create and register the output channel
 */
export function createOutputChannel(
  context: vscode.ExtensionContext,
  logLevel: LogLevel = LogLevel.INFO
): AutonomiOutputChannel {
  return new AutonomiOutputChannel(context, logLevel);
}
