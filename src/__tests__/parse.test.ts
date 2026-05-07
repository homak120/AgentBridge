import { describe, expect, it } from "vitest";
import { parseRequestBody } from "../converter/parse";
import { HttpError } from "../util/errors";

describe("parseRequestBody", () => {
  it("accepts a minimal valid body with string content", () => {
    const out = parseRequestBody({
      model: "claude-3-5-sonnet",
      max_tokens: 256,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(out.model).toBe("claude-3-5-sonnet");
    expect(out.messages[0]).toEqual({ role: "user", content: "hi" });
  });

  it("accepts content as an array of text blocks", () => {
    const out = parseRequestBody({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });
    expect(out.messages[0].content).toEqual([{ type: "text", text: "hello" }]);
  });

  it("rejects empty body", () => {
    expect(() => parseRequestBody({})).toThrow(HttpError);
  });

  it("rejects a non-object body", () => {
    expect(() => parseRequestBody(null)).toThrow(HttpError);
    expect(() => parseRequestBody([])).toThrow(HttpError);
    expect(() => parseRequestBody("string")).toThrow(HttpError);
  });

  it("requires messages to be a non-empty array", () => {
    expect(() =>
      parseRequestBody({ model: "m", max_tokens: 8, messages: [] }),
    ).toThrow(/non-empty array/);
  });

  it("requires the first message to be role user", () => {
    expect(() =>
      parseRequestBody({
        model: "m",
        max_tokens: 8,
        messages: [{ role: "assistant", content: "no" }],
      }),
    ).toThrow(/First message must have role "user"/);
  });

  it("requires max_tokens to be a positive number", () => {
    expect(() =>
      parseRequestBody({
        model: "m",
        max_tokens: 0,
        messages: [{ role: "user", content: "hi" }],
      }),
    ).toThrow(/max_tokens/);
  });

  it("preserves tool blocks for downstream stage to reject", () => {
    const out = parseRequestBody({
      model: "m",
      max_tokens: 8,
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "toolu_1", name: "t", input: { x: 1 } }],
        },
      ],
    });
    const second = out.messages[1].content;
    expect(Array.isArray(second)).toBe(true);
    expect((second as Array<{ type: string }>)[0].type).toBe("tool_use");
  });

  it("parses tools[] including JSON Schema input_schema", () => {
    const out = parseRequestBody({
      model: "m",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    });
    expect(out.tools).toHaveLength(1);
    expect(out.tools?.[0].name).toBe("get_weather");
  });
});
