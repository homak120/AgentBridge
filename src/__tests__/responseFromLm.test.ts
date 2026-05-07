import { describe, expect, it } from "vitest";
import { collectText } from "../converter/responseFromLm";
import { LanguageModelTextPart, LanguageModelToolCallPart } from "./__mocks__/vscode";

async function* gen(parts: unknown[]): AsyncIterable<unknown> {
  for (const p of parts) yield p;
}

describe("collectText (Phase 2)", () => {
  it("concatenates text parts in order", async () => {
    const text = await collectText(
      gen([new LanguageModelTextPart("Hello "), new LanguageModelTextPart("world")]),
    );
    expect(text).toBe("Hello world");
  });

  it("returns empty string for an empty stream", async () => {
    expect(await collectText(gen([]))).toBe("");
  });

  it("ignores non-text parts (tool calls etc.)", async () => {
    const text = await collectText(
      gen([
        new LanguageModelTextPart("ok"),
        new LanguageModelToolCallPart("toolu_1", "x", {}),
        new LanguageModelTextPart("!"),
      ]),
    );
    expect(text).toBe("ok!");
  });
});
