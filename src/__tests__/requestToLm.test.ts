import { describe, expect, it } from "vitest";
import { requestToLm } from "../converter/requestToLm";
import { HttpError } from "../util/errors";

describe("requestToLm (Phase 2: text only)", () => {
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

  it("flattens an array of text blocks", () => {
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
    expect(messages[0]).toMatchObject({ content: "part 1 part 2" });
  });

  it("rejects messages containing tool blocks", () => {
    expect(() =>
      requestToLm({
        model: "m",
        max_tokens: 8,
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "t1", name: "x", input: {} }],
          },
        ],
      }),
    ).toThrow(HttpError);
  });

  it("rejects requests with tools[] populated", () => {
    expect(() =>
      requestToLm({
        model: "m",
        max_tokens: 8,
        messages: [{ role: "user", content: "hi" }],
        tools: [{ name: "t", input_schema: {} }],
      }),
    ).toThrow(/Tool calling is not implemented/);
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
