/**
 * Mock Claude API server for integration testing
 *
 * Simulates the Claude API with controllable responses
 * that trigger hooks in predictable ways
 */
import { type Server, serve } from "bun";

interface MockToolResponse {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolOutput?: string;
}

interface MockServerConfig {
  port: number;
  responses: MockToolResponse[];
}

export class MockClaudeServer {
  private server: Server | null = null;
  private responseQueue: MockToolResponse[] = [];
  private port: number;
  private requestLog: Array<{ timestamp: Date; body: unknown }> = [];

  constructor(config: Partial<MockServerConfig> = {}) {
    this.port = config.port || 3457;
    this.responseQueue = config.responses || [];
  }

  /**
   * Queue a tool response that will trigger a specific hook
   */
  queueToolResponse(response: MockToolResponse): void {
    this.responseQueue.push(response);
  }

  /**
   * Queue an Edit tool call to trigger track-edit hook
   */
  queueEditResponse(
    filePath: string,
    oldString: string,
    newString: string
  ): void {
    this.queueToolResponse({
      toolName: "Edit",
      toolInput: {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      toolOutput: "Edit successful",
    });
  }

  /**
   * Queue a Write tool call to trigger track-edit hook
   */
  queueWriteResponse(filePath: string, content: string): void {
    this.queueToolResponse({
      toolName: "Write",
      toolInput: { file_path: filePath, content },
      toolOutput: "File written successfully",
    });
  }

  /**
   * Queue a TodoWrite call to trigger track-todos hook
   */
  queueTodoResponse(
    todos: { content: string; status: string; activeForm: string }[]
  ): void {
    this.queueToolResponse({
      toolName: "TodoWrite",
      toolInput: { todos },
    });
  }

  /**
   * Queue an ExitPlanMode call to trigger track-plan hook
   */
  queueExitPlanModeResponse(): void {
    this.queueToolResponse({
      toolName: "ExitPlanMode",
      toolInput: { reason: "Plan complete" },
    });
  }

  /**
   * Queue an AskUserQuestion response to trigger track-qa hook
   */
  queueAskUserResponse(
    questions: Array<{ question: string; header: string }>,
    answers: Record<string, string>
  ): void {
    this.queueToolResponse({
      toolName: "AskUserQuestion",
      toolInput: { questions, answers },
    });
  }

  /**
   * Start the mock server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = serve({
        port: this.port,
        fetch: async (req) => {
          // Handle Claude API messages endpoint
          if (req.method === "POST" && req.url.includes("/v1/messages")) {
            return this.handleMessagesRequest(req);
          }

          // Health check
          if (req.method === "GET" && req.url.includes("/health")) {
            return new Response(JSON.stringify({ status: "ok" }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response("Not found", { status: 404 });
        },
      });
      resolve();
    });
  }

  private async handleMessagesRequest(req: Request): Promise<Response> {
    const body = await req.json();
    this.requestLog.push({ timestamp: new Date(), body });

    // Generate response with queued tool calls
    const response = this.generateResponse();

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private generateResponse(): object {
    // Pop next queued response or return empty
    const nextTool = this.responseQueue.shift();

    if (nextTool) {
      return {
        id: `msg_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: "mock-claude",
        content: [
          {
            type: "tool_use",
            id: `tool_${Date.now()}`,
            name: nextTool.toolName,
            input: nextTool.toolInput,
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 100, output_tokens: 50 },
      };
    }

    return {
      id: `msg_${Date.now()}`,
      type: "message",
      role: "assistant",
      model: "mock-claude",
      content: [{ type: "text", text: "Done." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 10 },
    };
  }

  /**
   * Stop the mock server
   */
  stop(): void {
    this.server?.stop();
    this.server = null;
  }

  /**
   * Get the port the server is running on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the base URL for the mock server
   */
  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Get logged requests
   */
  getRequestLog(): Array<{ timestamp: Date; body: unknown }> {
    return [...this.requestLog];
  }

  /**
   * Clear request log
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Check how many responses are still queued
   */
  getPendingResponseCount(): number {
    return this.responseQueue.length;
  }
}
