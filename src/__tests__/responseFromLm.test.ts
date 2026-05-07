import { describe, expect, it } from "vitest";
import { collectResponse, processStream, type BlockSink } from "../converter/responseFromLm";
import type { StopReason } from "../converter/types";
import { LanguageModelTextPart, LanguageModelToolCallPart } from "./__mocks__/vscode";

async function* gen(parts: unknown[]): AsyncIterable<unknown> {
  for (const p of parts) yield p;
}

type Recorded =
  | { kind: "openText"; index: number }
  | { kind: "appendText"; index: number; text: string }
  | { kind: "closeText"; index: number }
  | { kind: "toolCall"; index: number; callId: string; name: string; input: unknown }
  | { kind: "end"; reason: StopReason };

function recordingSink(): { events: Recorded[]; sink: BlockSink } {
  const events: Recorded[] = [];
  return {
    events,
    sink: {
      openText: (index) => events.push({ kind: "openText", index }),
      appendText: (index, text) => events.push({ kind: "appendText", index, text }),
      closeText: (index) => events.push({ kind: "closeText", index }),
      toolCall: (index, callId, name, input) =>
        events.push({ kind: "toolCall", index, callId, name, input }),
      end: (reason) => events.push({ kind: "end", reason }),
    },
  };
}

describe("processStream — block-kind state machine", () => {
  it("text-only stream emits open/append/close + end_turn", async () => {
    const { events, sink } = recordingSink();
    await processStream(
      gen([new LanguageModelTextPart("Hello "), new LanguageModelTextPart("world")]),
      sink,
    );
    expect(events).toEqual([
      { kind: "openText", index: 0 },
      { kind: "appendText", index: 0, text: "Hello " },
      { kind: "appendText", index: 0, text: "world" },
      { kind: "closeText", index: 0 },
      { kind: "end", reason: "end_turn" },
    ]);
  });

  it("tool-only stream emits a single toolCall + tool_use stop_reason", async () => {
    const { events, sink } = recordingSink();
    await processStream(
      gen([new LanguageModelToolCallPart("toolu_xyz", "do_thing", { x: 1 })]),
      sink,
    );
    expect(events).toEqual([
      { kind: "toolCall", index: 0, callId: "toolu_xyz", name: "do_thing", input: { x: 1 } },
      { kind: "end", reason: "tool_use" },
    ]);
  });

  it("transitions text → tool_use → text correctly (last block is text → end_turn)", async () => {
    const { events, sink } = recordingSink();
    await processStream(
      gen([
        new LanguageModelTextPart("hi"),
        new LanguageModelToolCallPart("toolu_1", "f", { a: 1 }),
        new LanguageModelTextPart("bye"),
      ]),
      sink,
    );
    expect(events).toEqual([
      { kind: "openText", index: 0 },
      { kind: "appendText", index: 0, text: "hi" },
      { kind: "closeText", index: 0 },
      { kind: "toolCall", index: 1, callId: "toolu_1", name: "f", input: { a: 1 } },
      { kind: "openText", index: 2 },
      { kind: "appendText", index: 2, text: "bye" },
      { kind: "closeText", index: 2 },
      { kind: "end", reason: "end_turn" },
    ]);
  });

  it("tool_use as the last block produces tool_use stop_reason", async () => {
    const { events, sink } = recordingSink();
    await processStream(
      gen([
        new LanguageModelTextPart("running tool…"),
        new LanguageModelToolCallPart("toolu_2", "g", { b: 2 }),
      ]),
      sink,
    );
    const end = events[events.length - 1];
    expect(end).toEqual({ kind: "end", reason: "tool_use" });
  });

  it("empty stream emits only end_turn", async () => {
    const { events, sink } = recordingSink();
    await processStream(gen([]), sink);
    expect(events).toEqual([{ kind: "end", reason: "end_turn" }]);
  });

  it("two consecutive tool calls each get their own block index", async () => {
    const { events, sink } = recordingSink();
    await processStream(
      gen([
        new LanguageModelToolCallPart("toolu_1", "a", {}),
        new LanguageModelToolCallPart("toolu_2", "b", {}),
      ]),
      sink,
    );
    const indices = events.filter((e) => e.kind === "toolCall").map((e) => (e as { index: number }).index);
    expect(indices).toEqual([0, 1]);
  });
});

describe("collectResponse (non-streaming)", () => {
  it("returns one text block for text-only stream", async () => {
    const result = await collectResponse(
      gen([new LanguageModelTextPart("Hello "), new LanguageModelTextPart("world")]),
    );
    expect(result.blocks).toEqual([{ type: "text", text: "Hello world" }]);
    expect(result.stopReason).toBe("end_turn");
  });

  it("returns text + tool_use blocks in order", async () => {
    const result = await collectResponse(
      gen([
        new LanguageModelTextPart("Calling tool…"),
        new LanguageModelToolCallPart("toolu_xyz", "lookup", { city: "SF" }),
      ]),
    );
    expect(result.blocks).toEqual([
      { type: "text", text: "Calling tool…" },
      { type: "tool_use", id: "toolu_xyz", name: "lookup", input: { city: "SF" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
  });

  it("empty stream → empty blocks, end_turn", async () => {
    const result = await collectResponse(gen([]));
    expect(result.blocks).toEqual([]);
    expect(result.stopReason).toBe("end_turn");
  });
});
