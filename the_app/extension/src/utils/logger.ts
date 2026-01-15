/**
 * Logging utility for Autonomi VSCode Extension
 */

import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static outputChannel: vscode.OutputChannel | undefined;
  private static logLevel: LogLevel = LogLevel.INFO;

  /**
   * Initialize the logger with an output channel
   */
  static initialize(channel: vscode.OutputChannel, level: LogLevel = LogLevel.INFO): void {
    Logger.outputChannel = channel;
    Logger.logLevel = level;
  }

  /**
   * Set the log level
   */
  static setLevel(level: LogLevel): void {
    Logger.logLevel = level;
  }

  /**
   * Get the current log level
   */
  static getLevel(): LogLevel {
    return Logger.logLevel;
  }

  /**
   * Format a log message with timestamp and level
   */
  private static format(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  /**
   * Format additional arguments for logging
   */
  private static formatArgs(args: unknown[]): string {
    if (args.length === 0) {
      return '';
    }
    return ' ' + args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  }

  /**
   * Log a debug message
   */
  static debug(message: string, ...args: unknown[]): void {
    if (Logger.logLevel > LogLevel.DEBUG) {
      return;
    }
    const formatted = Logger.format('DEBUG', message + Logger.formatArgs(args));
    Logger.outputChannel?.appendLine(formatted);
    console.debug(formatted);
  }

  /**
   * Log an info message
   */
  static info(message: string, ...args: unknown[]): void {
    if (Logger.logLevel > LogLevel.INFO) {
      return;
    }
    const formatted = Logger.format('INFO', message + Logger.formatArgs(args));
    Logger.outputChannel?.appendLine(formatted);
    console.info(formatted);
  }

  /**
   * Log a warning message
   */
  static warn(message: string, ...args: unknown[]): void {
    if (Logger.logLevel > LogLevel.WARN) {
      return;
    }
    const formatted = Logger.format('WARN', message + Logger.formatArgs(args));
    Logger.outputChannel?.appendLine(formatted);
    console.warn(formatted);
  }

  /**
   * Log an error message
   */
  static error(message: string, error?: Error): void {
    const errorDetails = error
      ? ` | ${error.name}: ${error.message}${error.stack ? '\n' + error.stack : ''}`
      : '';
    const formatted = Logger.format('ERROR', message + errorDetails);
    Logger.outputChannel?.appendLine(formatted);
    console.error(formatted);
  }

  /**
   * Log a message with a specific level
   */
  static log(level: LogLevel, message: string, ...args: unknown[]): void {
    switch (level) {
      case LogLevel.DEBUG:
        Logger.debug(message, ...args);
        break;
      case LogLevel.INFO:
        Logger.info(message, ...args);
        break;
      case LogLevel.WARN:
        Logger.warn(message, ...args);
        break;
      case LogLevel.ERROR:
        Logger.error(message);
        break;
    }
  }

  /**
   * Show the output channel
   */
  static show(): void {
    Logger.outputChannel?.show();
  }

  /**
   * Clear the output channel
   */
  static clear(): void {
    Logger.outputChannel?.clear();
  }

  /**
   * Dispose of the logger
   */
  static dispose(): void {
    Logger.outputChannel?.dispose();
    Logger.outputChannel = undefined;
  }
}
