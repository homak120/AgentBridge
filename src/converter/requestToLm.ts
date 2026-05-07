import * as vscode from "vscode";
import { HttpError } from "../util/errors";
import type { Block, MessagesRequest } from "./types";

export interface ConvertedRequest {
  messages: vscode.LanguageModelChatMessage[];
  options: vscode.LanguageModelChatRequestOptions;
}

// Phase 2: text-only. Tool blocks and tools[] are rejected up front
// (see Phase 2 deliverables in 04-test-plan.md). Streaming and tool
// calling land in Phase 3.
export function requestToLm(req: MessagesRequest): ConvertedRequest {
  if (req.tools && req.tools.length > 0) {
    throw new HttpError(
      400,
      "invalid_request_error",
      "Tool calling is not implemented in this build (Phase 2).",
    );
  }

  const messages: vscode.LanguageModelChatMessage[] = [];

  // System prompt: prepended as a User message. vscode.LanguageModelChatMessage
  // has no dedicated System role today (see 02-protocol-translation.md).
  if (req.system && req.system.trim().length > 0) {
    messages.push(vscode.LanguageModelChatMessage.User(req.system));
  }

  for (const m of req.messages) {
    const text = collectText(m.content);
    if (m.role === "user") {
      messages.push(vscode.LanguageModelChatMessage.User(text));
    } else {
      messages.push(vscode.LanguageModelChatMessage.Assistant(text));
    }
  }

  const options: vscode.LanguageModelChatRequestOptions = {};
  return { messages, options };
}

function collectText(content: string | Block[]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === "text") {
      parts.push(b.text);
    } else {
      throw new HttpError(
        400,
        "invalid_request_error",
        `Block type "${b.type}" is not supported in this build (Phase 2 is text-only).`,
      );
    }
  }
  return parts.join("");
}
