/**
 * Autonomi Extension - Base Agent Class
 *
 * Abstract base class for all specialized agents in the system.
 * Provides common functionality and interface for agent implementations.
 *
 * Version: 1.0.0
 */

import {
  Task,
  AgentType,
  AgentResult,
  AgentConfig,
  Provider,
  Message,
  Artifact,
  ModelTier,
  CompletionRequest,
  Tool,
  ToolCall,
  ToolResult,
} from '../../types';

// ============================================================================
// Base Agent Abstract Class
// ============================================================================

export abstract class BaseAgent {
  protected type: AgentType;
  protected systemPrompt: string;
  protected provider: Provider;
  protected config: AgentConfig;
  protected tools: Tool[] = [];

  constructor(type: AgentType, provider: Provider, config?: Partial<AgentConfig>) {
    this.type = type;
    this.provider = provider;
    this.config = {
      type,
      model: config?.model ?? this.getDefaultModel(),
      maxTokens: config?.maxTokens ?? 4000,
      temperature: config?.temperature ?? 0.5,
      systemPromptOverride: config?.systemPromptOverride,
    };
    this.systemPrompt = this.config.systemPromptOverride ?? this.getSystemPrompt();
  }

  // ==========================================================================
  // Abstract Methods - Must be implemented by subclasses
  // ==========================================================================

  /**
   * Get the system prompt for this agent type
   * Each specialized agent provides its own optimized prompt
   */
  abstract getSystemPrompt(): string;

  /**
   * Get tools available to this agent type
   * Optional - agents can override to provide specialized tools
   */
  protected getTools(): Tool[] {
    return this.tools;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Execute a task using this agent
   */
  async execute(task: Task): Promise<AgentResult> {
    const startTime = Date.now();

    try {
      // Build messages for the completion request
      const messages = this.buildMessages(task);

      // Get tools for this agent
      const tools = this.getTools();

      // Make the completion request
      const request: CompletionRequest = {
        model: this.provider.getModel(this.config.model),
        messages,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        tools: tools.length > 0 ? tools : undefined,
      };

      const response = await this.provider.generateCompletion(request);

      // Handle tool calls if present
      let finalOutput = response.content;
      let toolCallResults: ToolResult[] = [];

      if (response.toolCalls && response.toolCalls.length > 0) {
        toolCallResults = await this.executeToolCalls(response.toolCalls);
        finalOutput = await this.synthesizeWithToolResults(
          task,
          response.content,
          toolCallResults
        );
      }

      // Extract artifacts from output
      const artifacts = this.extractArtifacts(finalOutput);

      // Build result
      const result: AgentResult = {
        agentType: this.type,
        taskId: task.id,
        success: true,
        output: finalOutput,
        artifacts,
        confidence: this.calculateConfidence(task, finalOutput),
        reasoning: this.buildReasoning(task, finalOutput),
        suggestedNextSteps: this.suggestNextSteps(task, finalOutput),
        warnings: this.identifyWarnings(task, finalOutput),
      };

      return result;
    } catch (error) {
      return this.createErrorResult(task, error);
    }
  }

  /**
   * Stream execution for real-time output
   */
  async *executeStream(task: Task): AsyncGenerator<{ type: string; content: string }> {
    const messages = this.buildMessages(task);
    const tools = this.getTools();

    const request: CompletionRequest = {
      model: this.provider.getModel(this.config.model),
      messages,
      maxTokens: this.config.maxTokens,
      temperature: this.config.temperature,
      tools: tools.length > 0 ? tools : undefined,
    };

    for await (const chunk of this.provider.streamCompletion(request)) {
      yield {
        type: chunk.type,
        content: chunk.delta ?? chunk.content,
      };
    }
  }

  /**
   * Get the agent type
   */
  getType(): AgentType {
    return this.type;
  }

  /**
   * Get the current configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /**
   * Update agent configuration
   */
  updateConfig(updates: Partial<AgentConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.systemPromptOverride !== undefined) {
      this.systemPrompt = updates.systemPromptOverride ?? this.getSystemPrompt();
    }
  }

  // ==========================================================================
  // Protected Methods - Can be overridden by subclasses
  // ==========================================================================

  /**
   * Get the default model tier for this agent type
   */
  protected getDefaultModel(): ModelTier {
    // Most agents use Sonnet by default
    // Specialized agents can override for Haiku (simple tasks) or Opus (complex reasoning)
    return 'sonnet';
  }

  /**
   * Build the message array for the completion request
   */
  protected buildMessages(task: Task): Message[] {
    const messages: Message[] = [
      {
        role: 'system',
        content: this.systemPrompt,
      },
      {
        role: 'user',
        content: this.buildTaskPrompt(task),
      },
    ];

    return messages;
  }

  /**
   * Build the task prompt from task details
   */
  protected buildTaskPrompt(task: Task): string {
    const contextLines: string[] = [];

    if (task.context.workspaceRoot) {
      contextLines.push(`Workspace: ${task.context.workspaceRoot}`);
    }
    if (task.context.language) {
      contextLines.push(`Language: ${task.context.language}`);
    }
    if (task.context.framework) {
      contextLines.push(`Framework: ${task.context.framework}`);
    }
    if (task.context.files.length > 0) {
      contextLines.push(`Files: ${task.context.files.join(', ')}`);
    }
    if (task.context.dependencies && task.context.dependencies.length > 0) {
      contextLines.push(`Dependencies: ${task.context.dependencies.join(', ')}`);
    }

    const context = contextLines.length > 0
      ? `\n\nContext:\n${contextLines.join('\n')}`
      : '';

    return `Task: ${task.description}
Type: ${task.type}
Priority: ${task.priority}${context}

Please complete this task thoroughly. Provide working code when applicable.`;
  }

  /**
   * Extract artifacts from the agent's output
   */
  protected extractArtifacts(output: string): Artifact[] {
    const artifacts: Artifact[] = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let index = 0;

    while ((match = codeBlockRegex.exec(output)) !== null) {
      const language = match[1] || 'text';
      const content = match[2].trim();

      if (content.length > 0) {
        artifacts.push({
          id: `artifact_${this.type}_${Date.now()}_${index++}`,
          type: this.inferArtifactType(language, content),
          name: this.generateArtifactName(language, index),
          content,
          mimeType: this.getMimeType(language),
        });
      }
    }

    return artifacts;
  }

  /**
   * Calculate confidence in the result
   */
  protected calculateConfidence(task: Task, output: string): number {
    let confidence = 0.7; // Base confidence

    // Adjust based on output quality indicators
    if (output.length > 100) confidence += 0.1;
    if (output.includes('```')) confidence += 0.1; // Contains code
    if (output.toLowerCase().includes('error')) confidence -= 0.1;
    if (output.toLowerCase().includes('warning')) confidence -= 0.05;
    if (output.toLowerCase().includes('note:')) confidence -= 0.05;

    // Clamp to valid range
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  /**
   * Build reasoning explanation for the result
   */
  protected buildReasoning(task: Task, output: string): string {
    return `Agent ${this.type} processed task "${task.description.slice(0, 50)}..." ` +
           `with ${this.config.model} model. ` +
           `Output length: ${output.length} characters.`;
  }

  /**
   * Suggest next steps based on the result
   */
  protected suggestNextSteps(task: Task, output: string): string[] {
    const suggestions: string[] = [];

    // Generic suggestions based on output analysis
    if (output.includes('TODO')) {
      suggestions.push('Complete TODO items identified in the output');
    }
    if (output.includes('test')) {
      suggestions.push('Run tests to verify the implementation');
    }
    if (!output.includes('```')) {
      suggestions.push('Request code implementation if needed');
    }

    return suggestions;
  }

  /**
   * Identify warnings in the result
   */
  protected identifyWarnings(task: Task, output: string): string[] {
    const warnings: string[] = [];

    if (output.toLowerCase().includes('deprecated')) {
      warnings.push('Output mentions deprecated features');
    }
    if (output.toLowerCase().includes('security')) {
      warnings.push('Security considerations mentioned - review carefully');
    }
    if (output.length < 50) {
      warnings.push('Output is unusually short - may be incomplete');
    }

    return warnings;
  }

  /**
   * Execute tool calls and return results
   */
  protected async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
    // Base implementation - subclasses can override for specific tool handling
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      results.push({
        toolCallId: call.id,
        output: `Tool ${call.name} not implemented in base agent`,
        success: false,
        error: 'Tool not implemented',
      });
    }

    return results;
  }

  /**
   * Synthesize final output with tool results
   */
  protected async synthesizeWithToolResults(
    task: Task,
    initialOutput: string,
    toolResults: ToolResult[]
  ): Promise<string> {
    // If no successful tool results, return initial output
    const successfulResults = toolResults.filter(r => r.success);
    if (successfulResults.length === 0) {
      return initialOutput;
    }

    // Build synthesis prompt
    const messages: Message[] = [
      {
        role: 'system',
        content: 'Synthesize the tool results into a final response.',
      },
      {
        role: 'user',
        content: `Initial response: ${initialOutput}\n\nTool results:\n${
          successfulResults.map(r => `- ${r.output}`).join('\n')
        }\n\nProvide the final synthesized response.`,
      },
    ];

    const response = await this.provider.generateCompletion({
      model: this.provider.getModel('haiku'),
      messages,
      maxTokens: 2000,
      temperature: 0.3,
    });

    return response.content;
  }

  // ==========================================================================
  // Private Helper Methods
  // ==========================================================================

  private inferArtifactType(language: string, content: string): Artifact['type'] {
    const lower = language.toLowerCase();

    if (lower.match(/test|spec/) || content.includes('describe(') || content.includes('test(')) {
      return 'test';
    }
    if (lower.match(/md|markdown/)) {
      return 'documentation';
    }
    if (lower.match(/json|yaml|yml|toml|ini|env|config/)) {
      return 'config';
    }
    if (lower.match(/mermaid|plantuml|dot/)) {
      return 'diagram';
    }

    return 'code';
  }

  private generateArtifactName(language: string, index: number): string {
    const extensions: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      go: 'go',
      rust: 'rs',
      java: 'java',
      csharp: 'cs',
      cpp: 'cpp',
      c: 'c',
      ruby: 'rb',
      php: 'php',
      swift: 'swift',
      kotlin: 'kt',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      yaml: 'yaml',
      sql: 'sql',
      markdown: 'md',
      shell: 'sh',
      bash: 'sh',
    };

    const ext = extensions[language.toLowerCase()] || 'txt';
    return `${this.type}_output_${index}.${ext}`;
  }

  private getMimeType(language: string): string {
    const mimeTypes: Record<string, string> = {
      typescript: 'text/typescript',
      javascript: 'text/javascript',
      python: 'text/x-python',
      json: 'application/json',
      yaml: 'text/yaml',
      html: 'text/html',
      css: 'text/css',
      markdown: 'text/markdown',
    };

    return mimeTypes[language.toLowerCase()] || 'text/plain';
  }

  private createErrorResult(task: Task, error: unknown): AgentResult {
    const message = error instanceof Error ? error.message : String(error);

    return {
      agentType: this.type,
      taskId: task.id,
      success: false,
      output: `Error: ${message}`,
      artifacts: [],
      confidence: 0,
      reasoning: `Agent ${this.type} failed to process task: ${message}`,
      warnings: [`Execution failed: ${message}`],
    };
  }
}

// ============================================================================
// Agent Context Interface
// ============================================================================

export interface AgentContext {
  workspaceRoot: string;
  currentFile?: string;
  selection?: string;
  diagnostics?: string[];
  gitStatus?: string;
  recentFiles?: string[];
}

// ============================================================================
// Agent Execution Options
// ============================================================================

export interface AgentExecutionOptions {
  stream?: boolean;
  timeout?: number;
  maxRetries?: number;
  context?: AgentContext;
}

// ============================================================================
// Exports
// ============================================================================

export { BaseAgent as default };
