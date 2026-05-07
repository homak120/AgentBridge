import * as vscode from "vscode";
import { HttpError } from "../util/errors";
import type {
  Block,
  Message,
  MessagesRequest,
  TextBlock,
  Tool,
  ToolChoice,
  ToolResultBlock,
  ToolUseBlock,
} from "./types";

export interface ConvertedRequest {
  messages: vscode.LanguageModelChatMessage[];
  options: vscode.LanguageModelChatRequestOptions;
}

// Phase 3: text + tool_use + tool_result blocks. tool_use_id is preserved
// byte-identically across encode/decode (see 02-protocol-translation.md
// "Critical invariant").
export function requestToLm(req: MessagesRequest): ConvertedRequest {
  const messages: vscode.LanguageModelChatMessage[] = [];

  // System prompt: prepended as a User message (no System role in vscode.lm yet).
  if (req.system && req.system.trim().length > 0) {
    messages.push(vscode.LanguageModelChatMessage.User(req.system));
  }

  for (const m of req.messages) {
    messages.push(toChatMessage(m));
  }

  const options: vscode.LanguageModelChatRequestOptions = {};

  applyTools(options, req.tools, req.tool_choice);

  return { messages, options };
}

function toChatMessage(m: Message): vscode.LanguageModelChatMessage {
  if (typeof m.content === "string") {
    return m.role === "user"
      ? vscode.LanguageModelChatMessage.User(m.content)
      : vscode.LanguageModelChatMessage.Assistant(m.content);
  }
  if (m.role === "user") {
    return vscode.LanguageModelChatMessage.User(buildUserParts(m.content));
  }
  return vscode.LanguageModelChatMessage.Assistant(buildAssistantParts(m.content));
}

function buildUserParts(
  blocks: Block[],
): Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart> {
  const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolResultPart> = [];
  for (const b of blocks) {
    if (b.type === "text") {
      parts.push(new vscode.LanguageModelTextPart(b.text));
    } else if (b.type === "tool_result") {
      parts.push(toToolResultPart(b));
    } else {
      throw new HttpError(
        400,
        "invalid_request_error",
        `Block "tool_use" is not valid in a user message; place it in an assistant message.`,
      );
    }
  }
  return parts;
}

function buildAssistantParts(
  blocks: Block[],
): Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> {
  const parts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
  for (const b of blocks) {
    if (b.type === "text") {
      parts.push(new vscode.LanguageModelTextPart(b.text));
    } else if (b.type === "tool_use") {
      parts.push(toToolCallPart(b));
    } else {
      throw new HttpError(
        400,
        "invalid_request_error",
        `Block "tool_result" is not valid in an assistant message; place it in a user message.`,
      );
    }
  }
  return parts;
}

function toToolCallPart(b: ToolUseBlock): vscode.LanguageModelToolCallPart {
  // CRITICAL INVARIANT: callId === b.id, byte-for-byte. Do not normalise.
  return new vscode.LanguageModelToolCallPart(b.id, b.name, b.input);
}

function toToolResultPart(b: ToolResultBlock): vscode.LanguageModelToolResultPart {
  // CRITICAL INVARIANT: callId === b.tool_use_id, byte-for-byte.
  const text = typeof b.content === "string" ? b.content : (b.content as TextBlock[]).map((c) => c.text).join("");
  return new vscode.LanguageModelToolResultPart(b.tool_use_id, [
    new vscode.LanguageModelTextPart(text),
  ]);
}

function applyTools(
  options: vscode.LanguageModelChatRequestOptions,
  tools: Tool[] | undefined,
  toolChoice: ToolChoice | undefined,
): void {
  const choice = normaliseToolChoice(toolChoice);

  if (choice && choice.kind === "none") {
    // Spec D2 / 02: omit tools entirely.
    return;
  }

  if (tools && tools.length > 0) {
    const filtered =
      choice && choice.kind === "tool"
        ? tools.filter((t) => t.name === choice.name)
        : tools;

    if (filtered.length > 0) {
      options.tools = filtered.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.input_schema,
      }));
    }
  }

  if (choice) {
    if (choice.kind === "auto") {
      options.toolMode = vscode.LanguageModelChatToolMode.Auto;
    } else if (choice.kind === "any" || choice.kind === "tool") {
      options.toolMode = vscode.LanguageModelChatToolMode.Required;
    }
  }
}

type NormalisedChoice =
  | { kind: "auto" }
  | { kind: "any" }
  | { kind: "none" }
  | { kind: "tool"; name: string }
  | null;

function normaliseToolChoice(c: ToolChoice | undefined): NormalisedChoice {
  if (!c) return null;
  if (c === "auto" || c === "any" || c === "none") return { kind: c };
  if ("type" in c) {
    if (c.type === "auto" || c.type === "any" || c.type === "none") return { kind: c.type };
    if (c.type === "tool") return { kind: "tool", name: c.name };
  }
  return null;
}
