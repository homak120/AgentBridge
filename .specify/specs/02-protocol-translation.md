# 02 — Protocol translation

This is the load-bearing spec. Read it before touching anything in
`src/converter/` or `src/routes/`.

## Two surfaces, side by side

### Anthropic Messages API (what clients send us)

```http
POST /v1/messages
Content-Type: application/json
x-api-key: anything            ← required header, value ignored (D3)
anthropic-version: 2023-06-01  ← validated; we accept "2023-06-01"

{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 4096,
  "stream": true,
  "system": "You are a helpful assistant.",
  "messages": [
    { "role": "user",      "content": "What's the weather?" },
    { "role": "assistant", "content": [
      { "type": "text",     "text": "Let me check." },
      { "type": "tool_use", "id": "toolu_01ABC", "name": "get_weather", "input": { "city": "SF" } }
    ]},
    { "role": "user", "content": [
      { "type": "tool_result", "tool_use_id": "toolu_01ABC", "content": "72°F, sunny" }
    ]}
  ],
  "tools": [
    { "name": "get_weather", "description": "...", "input_schema": { ... JSON Schema ... } }
  ],
  "tool_choice": { "type": "auto" },
  "temperature": 0.7,
  "top_p": 1.0
}
```

The `content` field is either a string (shorthand for one text block)
or an array of typed blocks: `text`, `tool_use`, `tool_result`,
`image`. We accept both forms on input; on output we always emit
arrays.

### `vscode.lm` (what we call)

```ts
const [model] = await vscode.lm.selectChatModels({ vendor: "copilot", family: "..." });
const messages: vscode.LanguageModelChatMessage[] = [...];
const options: vscode.LanguageModelChatRequestOptions = {
  tools: [{ name, description, inputSchema }],
  toolMode: vscode.LanguageModelChatToolMode.Auto,
};
const response = await model.sendRequest(messages, options, token);
for await (const part of response.stream) {
  // part is LanguageModelTextPart | LanguageModelToolCallPart | …
}
```

Messages are constructed with `LanguageModelChatMessage.User(...)` /
`.Assistant(...)`. Their `content` is an array of parts:
`LanguageModelTextPart`, `LanguageModelToolCallPart`,
`LanguageModelToolResultPart`. The shape mirrors Anthropic closely
enough that the conversion is mostly a renaming exercise — until
streaming and tool IDs enter.

## Mapping table

| Anthropic input                                    | vscode.lm equivalent                                                |
|----------------------------------------------------|---------------------------------------------------------------------|
| `system` (string)                                  | Prepended as a `LanguageModelChatMessage.User` with a system marker, OR passed via `options` if the API exposes it. See "System prompt" below. |
| `messages[].role: "user"`                          | `LanguageModelChatMessage.User(parts)`                              |
| `messages[].role: "assistant"`                     | `LanguageModelChatMessage.Assistant(parts)`                         |
| Block `{ type: "text", text }`                     | `new LanguageModelTextPart(text)`                                   |
| Block `{ type: "tool_use", id, name, input }`      | `new LanguageModelToolCallPart(id, name, input)`                    |
| Block `{ type: "tool_result", tool_use_id, content }` | `new LanguageModelToolResultPart(tool_use_id, [textParts])`      |
| `tools[]`                                          | `options.tools`: `{ name, description, inputSchema: input_schema }` |
| `tool_choice: "auto"` / `{type:"auto"}`            | `options.toolMode = Auto`                                           |
| `tool_choice: "any"` / `{type:"any"}`              | `options.toolMode = Required` (best available)                      |
| `tool_choice: {type:"tool", name}`                 | `options.toolMode = Required` + filter `tools` to that one          |
| `tool_choice: "none"`                              | omit `options.tools` entirely                                       |
| `temperature`, `top_p`, `max_tokens`               | best-effort via `options.modelOptions` if the model accepts; otherwise dropped silently with a log line |

| vscode.lm output                                   | Anthropic equivalent                                                |
|----------------------------------------------------|---------------------------------------------------------------------|
| `LanguageModelTextPart(text)`                      | append to current `text` block (or open one)                        |
| `LanguageModelToolCallPart(id, name, input)`       | emit a `tool_use` block with `{ id, name, input }`                  |
| stream end                                         | derive `stop_reason` (see below) and emit `message_stop`            |

## System prompt

VS Code's `LanguageModelChatMessage` does not expose a dedicated system
role. We follow the Copilot convention: prepend the system text as a
`LanguageModelChatMessage.User` whose first part is the system text,
followed by the actual conversation. If a future VS Code release adds
`LanguageModelChatMessage.System`, switch to it and update this spec.

## Critical invariant: tool_use_id round-tripping

The single rule that breaks tool calling if you get it wrong:

> **The `id` on a `tool_use` block emitted to the client must match
> the `tool_use_id` on the corresponding `tool_result` block the
> client sends back.**

This means:

1. When `vscode.lm` emits a `LanguageModelToolCallPart`, its
   `callId` becomes the `id` of the `tool_use` block we send to the
   client. **Do not regenerate it.** Do not prefix it. Do not lowercase
   it. Verbatim.
2. When the client's next request includes a `tool_result` with
   `tool_use_id: "X"`, the corresponding `LanguageModelToolResultPart`
   we construct must use `"X"` as its `callId`. Verbatim.
3. If the client invents an ID that vscode.lm has never seen (it
   shouldn't, but…), forward it anyway. The model decides what to do.

**Test this with a deliberate round-trip in unit tests** (Phase 3):
encode a tool call, decode the resulting tool_result, assert IDs are
byte-identical.

## Streaming: SSE event sequence

Anthropic's streaming format on the wire (we emit identical bytes):

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_…","type":"message","role":"assistant","model":"…","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_…","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"city\":\"SF\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42}}

event: message_stop
data: {"type":"message_stop"}
```

Key rules:
- Each event line ends with `\n\n`.
- `index` is the position of the block in the assistant message and
  monotonically non-decreasing.
- `content_block_start` and `content_block_stop` bracket every block.
  No deltas appear outside that bracket.
- For text blocks, deltas are `text_delta`. For tool_use blocks,
  deltas are `input_json_delta` carrying partial JSON.

### Block kind transition logic

The `vscode.lm` stream interleaves `LanguageModelTextPart` and
`LanguageModelToolCallPart` instances. We translate:

```
state := { currentBlockType: null, currentBlockIndex: -1, currentToolCallId: null }

for each part in vscode.lm stream:
  if part is TextPart:
    if state.currentBlockType != "text":
      if state.currentBlockType != null:
        emit content_block_stop(state.currentBlockIndex)
      state.currentBlockIndex += 1
      state.currentBlockType = "text"
      emit content_block_start(state.currentBlockIndex, { type:"text", text:"" })
    emit content_block_delta(state.currentBlockIndex, text_delta(part.value))

  if part is ToolCallPart:
    # Tool calls don't merge across boundaries — each tool call is its own block,
    # even if two tool calls arrive back-to-back.
    if state.currentBlockType != null:
      emit content_block_stop(state.currentBlockIndex)
    state.currentBlockIndex += 1
    state.currentBlockType = "tool_use"
    state.currentToolCallId = part.callId
    emit content_block_start(state.currentBlockIndex, { type:"tool_use", id:part.callId, name:part.name, input:{} })
    emit content_block_delta(state.currentBlockIndex, input_json_delta(JSON.stringify(part.input)))
    emit content_block_stop(state.currentBlockIndex)
    state.currentBlockType = null  # close immediately; next part opens a new block

at stream end:
  if state.currentBlockType != null:
    emit content_block_stop(state.currentBlockIndex)
  emit message_delta with stop_reason
  emit message_stop
```

`vscode.lm` delivers tool inputs as a single `LanguageModelToolCallPart`
with the full `input` object — we don't get token-level partial JSON.
We still emit the Anthropic `input_json_delta` event (clients expect
it) but with the entire stringified input as one chunk.

If we later detect that vscode.lm starts streaming partial tool inputs,
revisit this — emit incremental `input_json_delta` events instead.

### `stop_reason` derivation

| Final state                                                | `stop_reason` |
|------------------------------------------------------------|---------------|
| Stream ended, last block was `tool_use`                    | `tool_use`    |
| Stream ended, only text emitted, ran to completion         | `end_turn`    |
| Stream ended after hitting `max_tokens`                    | `max_tokens`  |
| Client aborted the HTTP connection                         | `end_turn` (we don't have a better signal); also stop the upstream `CancellationToken` |
| `vscode.lm` threw an error mid-stream                      | end the SSE with an `error` event; do not emit `message_stop` |

Detecting `max_tokens` from vscode.lm is best-effort — if the response
exposes a finish reason, use it; otherwise compare emitted token count
(approximated by chunk count) against the requested cap and infer.

## Errors

All HTTP errors use Anthropic's envelope:

```json
{ "type": "error", "error": { "type": "...", "message": "..." } }
```

| HTTP | `error.type`             | When                                                   |
|------|--------------------------|--------------------------------------------------------|
| 400  | `invalid_request_error`  | Body fails schema validation, missing model, etc.      |
| 401  | `authentication_error`   | `x-api-key` header missing entirely (we don't validate the value, but the header is required for API-shape parity) |
| 404  | `not_found_error`        | Unknown model with no fallback                         |
| 429  | `rate_limit_error`       | Copilot returned a quota/rate-limit error              |
| 500  | `api_error`              | Anything else, including unexpected vscode.lm errors   |
| 529  | `overloaded_error`       | Copilot returned an overload error                     |

For streaming responses, the `message_start` event has already gone
out before we know whether the upstream call will fail. If an error
arrives mid-stream, emit:

```
event: error
data: {"type":"error","error":{"type":"api_error","message":"…"}}
```

then close the response without `message_stop`.

## Edge cases worth writing tests for

- Empty `messages` array → 400.
- `messages[0].role == "assistant"` → 400 (Anthropic requires the
  first message be `user`).
- Same `tool_use_id` referenced twice in `tool_result` blocks → pass
  through; let the model handle it.
- `tool_use` block with `input: {}` (no arguments) → still emit a
  single `input_json_delta` with `"{}"`.
- Client disconnects mid-stream → cancel the `vscode.lm` request via
  the `CancellationToken`; do not leak it.
- `images` in user content → if vscode.lm supports images for the
  selected model, forward; otherwise return 400 with a clear message.
  Don't silently drop.
