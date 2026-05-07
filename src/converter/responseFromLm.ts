// Block-kind transition state machine for the vscode.lm response stream.
// Consumes vscode.lm parts and drives an opaque sink whose semantics
// match Anthropic's content_block_* event sequence.
//
// Two callers:
//   - SSE streaming (routes/messages.ts) supplies a sink that writes events.
//   - Non-streaming (collectResponse below) supplies a sink that builds the
//     final blocks[] array.
//
// See .specify/specs/02-protocol-translation.md for the rules.

import type { Block, StopReason, TextBlock, ToolUseBlock } from "./types";

export interface BlockSink {
  openText(index: number): void;
  appendText(index: number, text: string): void;
  closeText(index: number): void;
  // tool_use blocks are atomic: single complete input JSON, no partial deltas.
  toolCall(index: number, callId: string, name: string, input: unknown): void;
  end(stopReason: StopReason): void;
}

export async function processStream(
  stream: AsyncIterable<unknown>,
  sink: BlockSink,
): Promise<void> {
  let currentBlockType: "text" | null = null;
  let currentBlockIndex = -1;
  let lastBlockKind: "text" | "tool_use" | null = null;

  for await (const part of stream) {
    if (isTextPart(part)) {
      if (currentBlockType !== "text") {
        currentBlockIndex += 1;
        currentBlockType = "text";
        sink.openText(currentBlockIndex);
      }
      sink.appendText(currentBlockIndex, part.value);
      lastBlockKind = "text";
      continue;
    }

    if (isToolCallPart(part)) {
      if (currentBlockType === "text") {
        sink.closeText(currentBlockIndex);
        currentBlockType = null;
      }
      currentBlockIndex += 1;
      sink.toolCall(currentBlockIndex, part.callId, part.name, part.input);
      lastBlockKind = "tool_use";
      // Tool blocks are emitted atomically; the next part opens a fresh block.
      continue;
    }
    // Unknown parts are ignored (forward-compatible).
  }

  if (currentBlockType === "text") {
    sink.closeText(currentBlockIndex);
  }

  sink.end(deriveStopReason(lastBlockKind));
}

export interface CollectedResponse {
  blocks: Array<TextBlock | ToolUseBlock>;
  stopReason: StopReason;
}

// Non-streaming convenience: drives processStream with a collecting sink.
export async function collectResponse(
  stream: AsyncIterable<unknown>,
): Promise<CollectedResponse> {
  const blocks: Array<TextBlock | ToolUseBlock> = [];
  let textBuffer = "";
  let stopReason: StopReason = "end_turn";

  await processStream(stream, {
    openText() {
      textBuffer = "";
    },
    appendText(_index, text) {
      textBuffer += text;
    },
    closeText() {
      if (textBuffer.length > 0) {
        blocks.push({ type: "text", text: textBuffer });
      }
      textBuffer = "";
    },
    toolCall(_index, callId, name, input) {
      blocks.push({ type: "tool_use", id: callId, name, input });
    },
    end(reason) {
      stopReason = reason;
    },
  });

  return { blocks, stopReason };
}

function deriveStopReason(lastBlockKind: "text" | "tool_use" | null): StopReason {
  // Per spec 02 stop_reason table: last block tool_use → "tool_use",
  // otherwise "end_turn". max_tokens detection requires upstream signal
  // we don't currently have from vscode.lm.
  return lastBlockKind === "tool_use" ? "tool_use" : "end_turn";
}

interface TextPart {
  value: string;
}
interface ToolCallPart {
  callId: string;
  name: string;
  input: unknown;
}

function isTextPart(part: unknown): part is TextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "value" in part &&
    typeof (part as { value: unknown }).value === "string"
  );
}

function isToolCallPart(part: unknown): part is ToolCallPart {
  if (typeof part !== "object" || part === null) return false;
  const p = part as { callId?: unknown; name?: unknown };
  return typeof p.callId === "string" && typeof p.name === "string";
}

// Re-export for ergonomic import from routes/messages.ts
export type { Block };
