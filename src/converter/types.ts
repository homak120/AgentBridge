// Anthropic Messages API types — only the fields AgentBridge handles.
// See .specify/specs/02-protocol-translation.md.

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  // Tool input is a user-defined JSON-Schema payload (D10).
  input: any;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<TextBlock>;
  is_error?: boolean;
}

export type Block = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  content: string | Block[];
}

export interface Tool {
  name: string;
  description?: string;
  // JSON Schema; `any` permitted per D10.
  input_schema: any;
}

export type ToolChoice =
  | "auto"
  | "any"
  | "none"
  | { type: "auto" | "any" | "none" }
  | { type: "tool"; name: string };

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  messages: Message[];
  system?: string;
  stream?: boolean;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";

export interface MessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<TextBlock | ToolUseBlock>;
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
