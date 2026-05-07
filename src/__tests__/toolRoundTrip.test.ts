import { describe, expect, it } from "vitest";
import { parseRequestBody } from "../converter/parse";
import { requestToLm } from "../converter/requestToLm";
import { collectResponse } from "../converter/responseFromLm";
import {
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from "./__mocks__/vscode";

// CRITICAL INVARIANT (02-protocol-translation.md):
//   The id on a tool_use block emitted to the client must match
//   the tool_use_id on the corresponding tool_result block the
//   client sends back — byte-for-byte, no normalisation.
//
// This file proves that round trip in both directions through the
// converter. If any of these tests fail, agentic tool loops break.

describe("tool_use_id round trip", () => {
  it("vscode.lm tool-call id flows verbatim into the Anthropic tool_use block", async () => {
    const id = "toolu_01ABCxyz_unusual.chars-and+symbols";
    async function* gen() {
      yield new LanguageModelToolCallPart(id, "lookup", { city: "SF" });
    }

    const { blocks } = await collectResponse(gen());
    const toolUse = blocks.find((b) => b.type === "tool_use");
    expect(toolUse).toBeDefined();
    if (toolUse?.type !== "tool_use") throw new Error("unreachable");
    expect(toolUse.id).toBe(id); // byte-for-byte
    expect(toolUse.name).toBe("lookup");
    expect(toolUse.input).toEqual({ city: "SF" });
  });

  it("Anthropic tool_result.tool_use_id flows verbatim into LanguageModelToolResultPart.callId", () => {
    const id = "toolu_01ABCxyz_unusual.chars-and+symbols";
    const body = parseRequestBody({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "Run the tool." },
        {
          role: "assistant",
          content: [{ type: "tool_use", id, name: "lookup", input: { city: "SF" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: id, content: "72°F" }],
        },
      ],
    });
    const { messages } = requestToLm(body);

    // The third message is the user's tool_result. Inspect its parts.
    const last = messages[2] as unknown as { content: unknown[] };
    expect(Array.isArray(last.content)).toBe(true);
    const resultPart = last.content.find(
      (p) => p instanceof LanguageModelToolResultPart,
    ) as LanguageModelToolResultPart | undefined;
    expect(resultPart).toBeDefined();
    expect(resultPart?.callId).toBe(id); // byte-for-byte
  });

  it("full round trip: model emits tool call, client echoes tool_result, ids match", async () => {
    const id = "toolu_FullRoundTrip_42";

    // 1) Model emits a tool call.
    async function* upstream() {
      yield new LanguageModelToolCallPart(id, "f", { x: 1 });
    }
    const { blocks } = await collectResponse(upstream());
    const emittedToolUse = blocks.find((b) => b.type === "tool_use");
    if (!emittedToolUse || emittedToolUse.type !== "tool_use") {
      throw new Error("expected tool_use block");
    }

    // 2) Client builds the next request using that exact id verbatim.
    const body = parseRequestBody({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: emittedToolUse.id,
              name: emittedToolUse.name,
              input: emittedToolUse.input,
            },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: emittedToolUse.id, content: "ok" }],
        },
      ],
    });
    const { messages } = requestToLm(body);

    // 3) The assistant turn carries a LanguageModelToolCallPart with the same id.
    const assistantParts = (messages[1] as unknown as { content: unknown[] }).content;
    const callPart = (assistantParts as unknown[]).find(
      (p) => p instanceof LanguageModelToolCallPart,
    ) as LanguageModelToolCallPart | undefined;
    expect(callPart?.callId).toBe(id);

    // 4) The user turn's tool_result has the same callId.
    const userParts = (messages[2] as unknown as { content: unknown[] }).content;
    const resultPart = (userParts as unknown[]).find(
      (p) => p instanceof LanguageModelToolResultPart,
    ) as LanguageModelToolResultPart | undefined;
    expect(resultPart?.callId).toBe(id);
  });
});
