import { describe, expect, it } from "vitest";
import { SseWriter, type SseTransport } from "../converter/streaming";

function capture(): { transport: SseTransport; output: () => string; ended: () => boolean } {
  let buf = "";
  let didEnd = false;
  return {
    transport: {
      write: (s: string) => {
        buf += s;
      },
      end: () => {
        didEnd = true;
      },
    },
    output: () => buf,
    ended: () => didEnd,
  };
}

describe("SseWriter — individual events", () => {
  it("formats message_start", () => {
    const c = capture();
    new SseWriter(c.transport, "msg_test", "claude-3.5-sonnet").messageStart();
    expect(c.output()).toBe(
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","type":"message","role":"assistant","model":"claude-3.5-sonnet","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
    );
  });

  it("formats content_block_start for text", () => {
    const c = capture();
    new SseWriter(c.transport, "m", "x").contentBlockStart(0, { type: "text", text: "" });
    expect(c.output()).toBe(
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    );
  });

  it("formats content_block_start for tool_use", () => {
    const c = capture();
    new SseWriter(c.transport, "m", "x").contentBlockStart(1, {
      type: "tool_use",
      id: "toolu_abc",
      name: "lookup",
      input: {},
    });
    expect(c.output()).toBe(
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_abc","name":"lookup","input":{}}}\n\n',
    );
  });

  it("formats text_delta and input_json_delta", () => {
    const c = capture();
    const w = new SseWriter(c.transport, "m", "x");
    w.contentBlockDelta(0, { type: "text_delta", text: "Hi" });
    w.contentBlockDelta(1, { type: "input_json_delta", partial_json: '{"k":1}' });
    expect(c.output()).toBe(
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"k\\":1}"}}\n\n',
    );
  });

  it("formats message_delta + message_stop", () => {
    const c = capture();
    const w = new SseWriter(c.transport, "m", "x");
    w.messageDelta("end_turn", 12);
    w.messageStop();
    expect(c.output()).toBe(
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":12}}\n\n' +
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    );
  });

  it("formats error events", () => {
    const c = capture();
    new SseWriter(c.transport, "m", "x").error("api_error", "boom");
    expect(c.output()).toBe(
      'event: error\ndata: {"type":"error","error":{"type":"api_error","message":"boom"}}\n\n',
    );
  });

  it("every event line ends with double newline", () => {
    const c = capture();
    const w = new SseWriter(c.transport, "m", "x");
    w.messageStart();
    w.contentBlockStart(0, { type: "text", text: "" });
    w.contentBlockDelta(0, { type: "text_delta", text: "ok" });
    w.contentBlockStop(0);
    w.messageDelta("end_turn", 1);
    w.messageStop();
    const events = c.output().split("\n\n");
    // 6 events + trailing empty entry from final \n\n
    expect(events).toHaveLength(7);
    expect(events[events.length - 1]).toBe("");
  });
});

describe("SseWriter — golden file", () => {
  // The byte-for-byte sequence the spec example in 02-protocol-translation.md
  // describes (text, then tool_use, then end). Anything that breaks this is
  // a wire-format regression and existing Anthropic clients will notice.
  it("matches the spec example for text-then-tool", () => {
    const c = capture();
    const w = new SseWriter(c.transport, "msg_01", "claude-3.5-sonnet");

    w.messageStart();
    w.contentBlockStart(0, { type: "text", text: "" });
    w.contentBlockDelta(0, { type: "text_delta", text: "Hello" });
    w.contentBlockDelta(0, { type: "text_delta", text: " world" });
    w.contentBlockStop(0);
    w.contentBlockStart(1, { type: "tool_use", id: "toolu_01ABC", name: "get_weather", input: {} });
    w.contentBlockDelta(1, { type: "input_json_delta", partial_json: '{"city":"SF"}' });
    w.contentBlockStop(1);
    w.messageDelta("tool_use", 42);
    w.messageStop();

    const expected = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-3.5-sonnet","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01ABC","name":"get_weather","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"SF\\"}"}}',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
      "",
    ].join("\n\n");

    expect(c.output()).toBe(expected);
  });
});
