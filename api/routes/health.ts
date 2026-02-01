/**
 * Health Check Routes
 *
 * Endpoints for monitoring and health checks.
 */

import { cliBridge } from "../services/cli-bridge.ts";
import { eventBus } from "../services/event-bus.ts";
import type { HealthResponse } from "../types/api.ts";

const startTime = Date.now();
const version = Deno.env.get("LOKI_VERSION") || "dev";

/**
 * GET /health - Basic health check
 */
export async function healthCheck(_req: Request): Promise<Response> {
  const sessions = await cliBridge.listSessions();
  const runningSession = sessions.find((s) => s.status === "running");

  // Check provider availability
  const providers = await checkProviders();

  const response: HealthResponse = {
    status: providers.claude ? "healthy" : "degraded",
    version,
    uptime: Date.now() - startTime,
    providers,
    activeSession: runningSession?.id || null,
  };

  return new Response(JSON.stringify(response), {
    status: response.status === "healthy" ? 200 : 503,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET /health/ready - Readiness probe
 */
export async function readinessCheck(_req: Request): Promise<Response> {
  // Check if we can access the CLI
  try {
    await cliBridge.executeCommand(["--version"], 5000);
    return new Response(JSON.stringify({ ready: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ready: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

/**
 * GET /health/live - Liveness probe
 */
export function livenessCheck(_req: Request): Response {
  return new Response(
    JSON.stringify({
      alive: true,
      uptime: Date.now() - startTime,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * GET /api/status - Detailed status
 */
export async function detailedStatus(_req: Request): Promise<Response> {
  const sessions = await cliBridge.listSessions();
  const providers = await checkProviders();

  const runningCount = sessions.filter((s) => s.status === "running").length;
  const completedCount = sessions.filter((s) => s.status === "completed").length;
  const failedCount = sessions.filter((s) => s.status === "failed").length;

  return new Response(
    JSON.stringify({
      version,
      uptime: Date.now() - startTime,
      uptimeFormatted: formatUptime(Date.now() - startTime),
      providers,
      sessions: {
        total: sessions.length,
        running: runningCount,
        completed: completedCount,
        failed: failedCount,
      },
      events: {
        subscribers: eventBus.getSubscriberCount(),
        historySize: eventBus.getHistory({}).length,
      },
      system: {
        platform: Deno.build.os,
        arch: Deno.build.arch,
        denoVersion: Deno.version.deno,
        v8Version: Deno.version.v8,
      },
    }),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Check provider availability
 */
async function checkProviders(): Promise<{
  claude: boolean;
  codex: boolean;
  gemini: boolean;
}> {
  const checkCommand = async (cmd: string): Promise<boolean> => {
    try {
      const command = new Deno.Command("which", {
        args: [cmd],
        stdout: "null",
        stderr: "null",
      });
      const output = await command.output();
      return output.success;
    } catch {
      return false;
    }
  };

  const [claude, codex, gemini] = await Promise.all([
    checkCommand("claude"),
    checkCommand("codex"),
    checkCommand("gemini"),
  ]);

  return { claude, codex, gemini };
}

/**
 * Format uptime to human-readable string
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
