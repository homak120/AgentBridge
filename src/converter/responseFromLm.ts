import type * as vscode from "vscode";

// Phase 2: collect text parts from the vscode.lm async stream and
// return one concatenated string. Phase 3 replaces this with the SSE
// emitter and the block-kind transition state machine.
export async function collectText(
  stream: AsyncIterable<unknown>,
): Promise<string> {
  let out = "";
  for await (const part of stream) {
    if (isTextPart(part)) {
      out += part.value;
    }
    // Tool-call parts and other kinds are ignored in Phase 2 — clients
    // shouldn't see them because we reject `tools` at the request boundary.
  }
  return out;
}

function isTextPart(part: unknown): part is vscode.LanguageModelTextPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "value" in part &&
    typeof (part as { value: unknown }).value === "string"
  );
}
