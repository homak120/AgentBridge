// SSE event encoding for the Anthropic Messages streaming protocol.
// Pure formatting: takes an SseTransport, writes wire bytes. The state
// machine in responseFromLm.ts decides *what* to emit; this file decides
// only *how*. See .specify/specs/02-protocol-translation.md.

import type { AnthropicErrorType } from "../util/errors";
import type { StopReason } from "./types";

export interface SseTransport {
  write(chunk: string): void;
  end(): void;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: object };

export type BlockDelta =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string };

export class SseWriter {
  constructor(
    private readonly transport: SseTransport,
    private readonly messageId: string,
    private readonly model: string,
  ) {}

  messageStart(): void {
    this.send("message_start", {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  contentBlockStart(index: number, block: ContentBlock): void {
    this.send("content_block_start", {
      type: "content_block_start",
      index,
      content_block: block,
    });
  }

  contentBlockDelta(index: number, delta: BlockDelta): void {
    this.send("content_block_delta", {
      type: "content_block_delta",
      index,
      delta,
    });
  }

  contentBlockStop(index: number): void {
    this.send("content_block_stop", {
      type: "content_block_stop",
      index,
    });
  }

  messageDelta(stopReason: StopReason, outputTokens: number): void {
    this.send("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens },
    });
  }

  messageStop(): void {
    this.send("message_stop", { type: "message_stop" });
  }

  // Mid-stream error: emit Anthropic's error event without a message_stop
  // (per spec 02). Caller decides whether to also call transport.end().
  error(type: AnthropicErrorType, message: string): void {
    this.send("error", {
      type: "error",
      error: { type, message },
    });
  }

  private send(event: string, data: unknown): void {
    this.transport.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
