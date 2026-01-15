/**
 * Autonomi VSCode Extension - Main Entry Point
 *
 * This is the main entry point for the Autonomi VSCode extension.
 * It handles activation and deactivation of the extension.
 */

import * as vscode from 'vscode';
import { AutonomiExtension } from './autonomi-extension';

let extension: AutonomiExtension | undefined;

/**
 * Activate the extension
 * Called when the extension is activated (e.g., when a command is executed)
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Autonomi extension activating...');

  try {
    extension = new AutonomiExtension(context);
    await extension.initialize();

    console.log('Autonomi extension activated');
  } catch (error) {
    console.error('Failed to activate Autonomi extension:', error);
    vscode.window.showErrorMessage(
      `Failed to activate Autonomi extension: ${(error as Error).message}`
    );
    throw error;
  }
}

/**
 * Deactivate the extension
 * Called when the extension is deactivated (e.g., when VS Code is closing)
 */
export function deactivate(): void {
  console.log('Autonomi extension deactivating...');

  if (extension) {
    extension.dispose();
    extension = undefined;
  }

  console.log('Autonomi extension deactivated');
}
