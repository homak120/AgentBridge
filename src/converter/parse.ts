import { HttpError } from "../util/errors";
import type { Block, Message, MessagesRequest, Tool, ToolChoice } from "./types";

// Validate-and-narrow the parsed JSON body of POST /v1/messages.
// `any` is allowed at this single boundary per decision D10.
export function parseRequestBody(raw: any): MessagesRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw bad("Body must be a JSON object.");
  }

  if (typeof raw.model !== "string" || raw.model.length === 0) {
    throw bad('Field "model" is required and must be a non-empty string.');
  }
  if (typeof raw.max_tokens !== "number" || !Number.isFinite(raw.max_tokens) || raw.max_tokens <= 0) {
    throw bad('Field "max_tokens" is required and must be a positive number.');
  }
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    throw bad('Field "messages" must be a non-empty array.');
  }

  const messages: Message[] = raw.messages.map((m: unknown, i: number) => parseMessage(m, i));

  if (messages[0].role !== "user") {
    throw bad('First message must have role "user".');
  }

  const out: MessagesRequest = {
    model: raw.model,
    max_tokens: raw.max_tokens,
    messages,
  };

  if (raw.system !== undefined) {
    if (typeof raw.system !== "string") throw bad('Field "system" must be a string.');
    out.system = raw.system;
  }
  if (raw.stream !== undefined) {
    if (typeof raw.stream !== "boolean") throw bad('Field "stream" must be a boolean.');
    out.stream = raw.stream;
  }
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) throw bad('Field "tools" must be an array.');
    out.tools = raw.tools.map((t: unknown, i: number) => parseTool(t, i));
  }
  if (raw.tool_choice !== undefined) {
    out.tool_choice = parseToolChoice(raw.tool_choice);
  }
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== "number") throw bad('Field "temperature" must be a number.');
    out.temperature = raw.temperature;
  }
  if (raw.top_p !== undefined) {
    if (typeof raw.top_p !== "number") throw bad('Field "top_p" must be a number.');
    out.top_p = raw.top_p;
  }
  if (raw.stop_sequences !== undefined) {
    if (!Array.isArray(raw.stop_sequences) || !raw.stop_sequences.every((s: unknown) => typeof s === "string")) {
      throw bad('Field "stop_sequences" must be an array of strings.');
    }
    out.stop_sequences = raw.stop_sequences;
  }

  return out;
}

function parseMessage(raw: unknown, index: number): Message {
  if (!raw || typeof raw !== "object") {
    throw bad(`messages[${index}] must be an object.`);
  }
  const m = raw as Record<string, unknown>;
  if (m.role !== "user" && m.role !== "assistant") {
    throw bad(`messages[${index}].role must be "user" or "assistant".`);
  }
  if (typeof m.content === "string") {
    return { role: m.role, content: m.content };
  }
  if (!Array.isArray(m.content)) {
    throw bad(`messages[${index}].content must be a string or an array of blocks.`);
  }
  const blocks: Block[] = m.content.map((b, i) => parseBlock(b, index, i));
  return { role: m.role, content: blocks };
}

function parseBlock(raw: unknown, mIdx: number, bIdx: number): Block {
  if (!raw || typeof raw !== "object") {
    throw bad(`messages[${mIdx}].content[${bIdx}] must be an object.`);
  }
  const b = raw as Record<string, unknown>;
  switch (b.type) {
    case "text": {
      if (typeof b.text !== "string") {
        throw bad(`messages[${mIdx}].content[${bIdx}].text must be a string.`);
      }
      return { type: "text", text: b.text };
    }
    case "tool_use": {
      if (typeof b.id !== "string" || typeof b.name !== "string") {
        throw bad(`messages[${mIdx}].content[${bIdx}] tool_use requires "id" and "name" strings.`);
      }
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    }
    case "tool_result": {
      if (typeof b.tool_use_id !== "string") {
        throw bad(`messages[${mIdx}].content[${bIdx}].tool_use_id must be a string.`);
      }
      const content = b.content;
      if (typeof content === "string") {
        return { type: "tool_result", tool_use_id: b.tool_use_id, content, is_error: b.is_error === true };
      }
      if (Array.isArray(content) && content.every((c: unknown) => isTextBlockShape(c))) {
        return {
          type: "tool_result",
          tool_use_id: b.tool_use_id,
          content: content as Array<{ type: "text"; text: string }>,
          is_error: b.is_error === true,
        };
      }
      throw bad(`messages[${mIdx}].content[${bIdx}].content must be a string or array of text blocks.`);
    }
    default:
      throw bad(`messages[${mIdx}].content[${bIdx}].type "${String(b.type)}" is not supported.`);
  }
}

function isTextBlockShape(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).type === "text" &&
    typeof (v as Record<string, unknown>).text === "string"
  );
}

function parseTool(raw: unknown, index: number): Tool {
  if (!raw || typeof raw !== "object") {
    throw bad(`tools[${index}] must be an object.`);
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== "string" || t.name.length === 0) {
    throw bad(`tools[${index}].name must be a non-empty string.`);
  }
  if (t.input_schema === undefined) {
    throw bad(`tools[${index}].input_schema is required.`);
  }
  const out: Tool = { name: t.name, input_schema: t.input_schema };
  if (typeof t.description === "string") out.description = t.description;
  return out;
}

function parseToolChoice(raw: unknown): ToolChoice {
  if (raw === "auto" || raw === "any" || raw === "none") return raw;
  if (raw && typeof raw === "object") {
    const c = raw as Record<string, unknown>;
    if (c.type === "auto" || c.type === "any" || c.type === "none") return { type: c.type };
    if (c.type === "tool" && typeof c.name === "string") return { type: "tool", name: c.name };
  }
  throw bad('Field "tool_choice" must be "auto" | "any" | "none" | {type:"tool", name}.');
}

function bad(message: string): HttpError {
  return new HttpError(400, "invalid_request_error", message);
}
