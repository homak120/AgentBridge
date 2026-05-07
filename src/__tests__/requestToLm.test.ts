import { describe, expect, it } from "vitest";
import { requestToLm } from "../converter/requestToLm";
import {
  LanguageModelChatToolMode,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolResultPart,
} from "./__mocks__/vscode";

describe("requestToLm — text", () => {
  it("converts a simple user message", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: "user", content: "hello" });
  });

  it("prepends system prompt as a User message", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      system: "You are pithy.",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "You are pithy." });
    expect(messages[1]).toMatchObject({ role: "user", content: "hi" });
  });

  it("ignores empty/whitespace-only system prompt", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      system: "   ",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(messages).toHaveLength(1);
  });

  it("preserves user/assistant role ordering", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "Q1" },
        { role: "assistant", content: "A1" },
        { role: "user", content: "Q2" },
      ],
    });
    expect(messages.map((m) => (m as unknown as { role: string }).role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
  });
});

describe("requestToLm — block content", () => {
  it("flattens text blocks in user content into LanguageModelTextPart parts", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "part 1 " },
            { type: "text", text: "part 2" },
          ],
        },
      ],
    });
    const parts = (messages[0] as unknown as { content: unknown[] }).content as unknown[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeInstanceOf(LanguageModelTextPart);
    expect((parts[0] as LanguageModelTextPart).value).toBe("part 1 ");
  });

  it("converts assistant tool_use blocks to LanguageModelToolCallPart", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "run it" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Calling…" },
            { type: "tool_use", id: "toolu_1", name: "f", input: { x: 1 } },
          ],
        },
      ],
    });
    const parts = (messages[1] as unknown as { content: unknown[] }).content as unknown[];
    expect(parts[0]).toBeInstanceOf(LanguageModelTextPart);
    expect(parts[1]).toBeInstanceOf(LanguageModelToolCallPart);
    const call = parts[1] as LanguageModelToolCallPart;
    expect(call.callId).toBe("toolu_1");
    expect(call.name).toBe("f");
    expect(call.input).toEqual({ x: 1 });
  });

  it("converts user tool_result blocks to LanguageModelToolResultPart", () => {
    const { messages } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "f", input: {} }] },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "result text" }],
        },
      ],
    });
    const parts = (messages[2] as unknown as { content: unknown[] }).content as unknown[];
    expect(parts[0]).toBeInstanceOf(LanguageModelToolResultPart);
    const result = parts[0] as LanguageModelToolResultPart;
    expect(result.callId).toBe("toolu_2");
  });

  it("rejects tool_use in a user message", () => {
    expect(() =>
      requestToLm({
        model: "m",
        max_tokens: 8,
        messages: [
          {
            role: "user",
            content: [{ type: "tool_use", id: "x", name: "y", input: {} }],
          },
        ],
      }),
    ).toThrow(/tool_use.*not valid in a user message/i);
  });

  it("rejects tool_result in an assistant message", () => {
    expect(() =>
      requestToLm({
        model: "m",
        max_tokens: 8,
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: [{ type: "tool_result", tool_use_id: "x", content: "y" }],
          },
        ],
      }),
    ).toThrow(/tool_result.*not valid in an assistant message/i);
  });
});

describe("requestToLm — tools and tool_choice", () => {
  it("forwards tools[] into options.tools", () => {
    const { options } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "get_weather", description: "Get weather", input_schema: { type: "object" } },
      ],
    });
    expect(options.tools).toHaveLength(1);
    expect(options.tools?.[0]).toMatchObject({
      name: "get_weather",
      description: "Get weather",
    });
  });

  it("tool_choice 'auto' sets toolMode to Auto", () => {
    const { options } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "x", input_schema: {} }],
      tool_choice: "auto",
    });
    expect(options.toolMode).toBe(LanguageModelChatToolMode.Auto);
  });

  it("tool_choice 'any' sets toolMode to Required", () => {
    const { options } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "x", input_schema: {} }],
      tool_choice: "any",
    });
    expect(options.toolMode).toBe(LanguageModelChatToolMode.Required);
  });

  it("tool_choice {type:tool, name} filters tools and sets Required", () => {
    const { options } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "a", input_schema: {} },
        { name: "b", input_schema: {} },
        { name: "c", input_schema: {} },
      ],
      tool_choice: { type: "tool", name: "b" },
    });
    expect(options.toolMode).toBe(LanguageModelChatToolMode.Required);
    expect(options.tools).toHaveLength(1);
    expect(options.tools?.[0].name).toBe("b");
  });

  it("tool_choice 'none' omits tools entirely", () => {
    const { options } = requestToLm({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "a", input_schema: {} }],
      tool_choice: "none",
    });
    expect(options.tools).toBeUndefined();
    expect(options.toolMode).toBeUndefined();
  });
});
