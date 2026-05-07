# 04 — Test plan & build phases

Four phases. Each one ends with a smoke test that must pass before
the next phase begins. Don't run ahead.

Branch naming: `phase-1-sidebar`, `phase-2-server`,
`phase-3-streaming-tools`, `phase-4-polish`.

---

## Phase 1 — Scaffold + sidebar shell

**Goal:** the extension installs, activates lazily, shows a sidebar
that can flip between "stopped" and "running" via a fake controller.
No real HTTP server yet.

### Deliverables

- `package.json` with:
  - `name: "agentbridge"`, `displayName: "AgentBridge"`, publisher,
    version `0.0.1`.
  - `engines.vscode` set to a recent stable (~`^1.95.0`).
  - `activationEvents: ["onView:agentbridge.controlPanel"]` — only
    this one (decision D5).
  - `contributes`:
    - `viewsContainers.activitybar`: `agentbridge` (id), title
      `AgentBridge`, icon path.
    - `views.agentbridge`: one webview view `agentbridge.controlPanel`.
    - `commands`: `agentbridge.start`, `agentbridge.stop`,
      `agentbridge.toggle`.
    - `configuration`: `agentbridge.port` (default 3000),
      `agentbridge.defaultModel` (default `null`).
- TypeScript strict configured. Build via `tsc` or `esbuild` — pick
  one in Phase 1 and commit to it.
- Vitest configured with one passing smoke test (e.g.
  `serverController.test.ts` asserting initial state is `stopped`).
- `vscode` mocked in tests (small hand-rolled mock module, no
  external dep).
- `src/extension.ts` registering the webview provider and commands.
- `src/serverController.ts` as a state machine + EventEmitter. In
  Phase 1 `start()` just transitions to `running` after a 200 ms
  fake delay; `stop()` to `stopped`. **No** `app.listen`.
- `src/ui/controlPanel.ts` + media files implementing the layout
  from `03-ui.md`. The model dropdown can be empty / show a
  placeholder in this phase.

### Smoke test (manual)

1. `npm install && npm run build && npm test`. Test passes.
2. `F5` opens the Extension Development Host.
3. The AgentBridge icon appears in the activity bar.
4. Click it → sidebar shows the Control panel with a grey "Stopped"
   pill and a "Start server" button.
5. Click "Start server" → pill turns amber "Starting…" briefly,
   then green "Running". Button label flips to "Stop server".
6. Click "Stop server" → pill returns to grey "Stopped".
7. Reload the window; observe the extension does **not** activate
   until you open the sidebar (check the OutputChannel or a temporary
   `console.log` in `activate`).

### Stop conditions

If the manual smoke test passes and `npm test` is green, Phase 1 is
done. Open a PR, summarize, **stop**.

---

## Phase 2 — Real server + minimal /v1/messages

**Goal:** start an actual HTTP server on `127.0.0.1:3000`. Handle
non-streaming text-only `POST /v1/messages` end-to-end against
`vscode.lm`. No streaming, no tool calls.

### Deliverables

- `express` (or chosen framework — see decision D1) wired up in
  `src/server.ts`.
- `serverController.start()` actually calls `app.listen(port, "127.0.0.1")`.
  Surface `EADDRINUSE` and other listen errors as `error` state.
- `routes/messages.ts` handles `POST /v1/messages`:
  - Validates required headers (`x-api-key` present, value
    discarded; `anthropic-version` accepted).
  - Validates request body: `model`, `messages`, `max_tokens`.
  - Converts via `requestToLm` (text blocks only — tool blocks raise
    `not_implemented` in this phase).
  - Resolves model via `lm/models.ts`. If unknown, fall back to
    `agentbridge.defaultModel`; if that's null, 404.
  - Calls `model.sendRequest(...)`, awaits the entire stream,
    accumulates text, returns one Anthropic JSON response (no SSE).
- `routes/models.ts` handles `GET /v1/models`, returning the
  `vscode.lm` list mapped into Anthropic-style entries.
- Anthropic error envelope used for every error path
  (`util/errors.ts`).
- Unit tests for: request validation, error envelope shape,
  text-only converter (round-trip a small message).

### Smoke tests (all four must pass)

**2A — Server lifecycle**
1. Start the server from the sidebar.
2. `curl http://127.0.0.1:3000/v1/models -H "x-api-key: test"`
   returns 200 with a non-empty `data` array (assuming Copilot is
   signed in).
3. Stop the server. The same curl now fails with
   `connection refused`.

**2B — Text round-trip**
```bash
curl -sS http://127.0.0.1:3000/v1/messages \
  -H "x-api-key: test" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Reply with the single word: pong"}]
  }'
```
Returns a JSON message whose first text block contains "pong" (case-
insensitive).

**2C — Localhost binding (decision D7)**
- `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows the server bound to
  `127.0.0.1:3000`, not `*:3000`.
- From another machine on the LAN,
  `curl http://<host-ip>:3000/v1/models` either fails or
  returns nothing. (If you can't test cross-machine, at minimum
  confirm the lsof output.)

**2D — Bad request shape**
```bash
curl -sS http://127.0.0.1:3000/v1/messages \
  -H "x-api-key: test" -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{}'
```
Returns 400 with the Anthropic error envelope:
`{"type":"error","error":{"type":"invalid_request_error","message":"…"}}`.

### Stop conditions

All four smoke tests green and unit tests passing → Phase 2 done.
PR, summarize, stop.

---

## Phase 3 — Streaming + tool calling

**Goal:** Claude Code can run end-to-end against AgentBridge,
including agentic tool loops.

### Deliverables

- `converter/streaming.ts` implements the SSE event sequence in
  `02-protocol-translation.md`.
- `converter/responseFromLm.ts` implements the block-kind transition
  state machine (text ↔ tool_use boundaries).
- `routes/messages.ts` branches on `stream: true` — non-streaming
  path keeps the Phase 2 buffering behaviour; streaming path emits
  SSE.
- `requestToLm` now handles `tool_use` and `tool_result` blocks and
  forwards `tools`, `tool_choice`.
- `stop_reason` derivation per the spec table.
- Cancellation: when the HTTP request closes, fire the
  `vscode.lm` `CancellationToken`.
- Comprehensive unit tests in `src/__tests__/converter.test.ts`
  covering:
  - Tool-use ID round trip — encode a `LanguageModelToolCallPart`
    with id `"toolu_01ABC"`, decode the resulting `tool_result`,
    assert ID is byte-identical.
  - Block-kind transitions: text → tool_use → text emits exactly
    the right `content_block_start` / `_stop` pairs.
  - `stop_reason`: `end_turn`, `tool_use`, `max_tokens`.
  - SSE framing: bytes match the spec example exactly (golden file
    test).

### Smoke tests

**3A — Streaming text**
Same curl as 2B but with `"stream": true`. Output is a sequence of
`event: message_start` / `content_block_*` / `message_stop` lines,
parsable by an SSE client.

**3B — Tool call round trip (manual)**
Send a request with one tool defined and a prompt that should trigger
it. Observe in the response: a `content_block_start` with
`type: "tool_use"`, an `input_json_delta`, a `content_block_stop`,
then `message_delta` with `stop_reason: "tool_use"`. Capture the
`id`. Send a follow-up request including a `tool_result` block with
that exact `tool_use_id` and observe a coherent reply.

**3C — Cancellation**
`curl --max-time 1` against a streaming request. After the curl
disconnects, no further log lines from the request handler appear,
and no orphaned vscode.lm requests remain (check OutputChannel).

**3D — End-to-end with Claude Code (the real test)**
```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:3000
export ANTHROPIC_API_KEY=anything
claude
```
Then ask Claude Code to perform a small multi-step task that exercises
tools (e.g. "read the README and summarize it"). It must:
- Stream tokens visibly.
- Successfully call its built-in tools (Read, Bash, etc.) and
  receive results.
- Complete the task without protocol errors.

### Stop conditions

All four smoke tests pass, including 3D. Unit tests cover the four
named scenarios. PR, summarize, stop.

---

## Phase 4 — Polish + docs

**Goal:** a stranger can install AgentBridge, follow the README, and
have it working in under five minutes.

### Deliverables

- `README.md` rewritten:
  - One-paragraph what / why.
  - Install instructions (from VSIX or Marketplace, whichever ships
    first).
  - Three-line quick-start showing the env vars and `claude` invocation.
  - Troubleshooting section (no models available, port in use, LAN
    not accessible — by design).
  - Link to `.specify/specs/` for contributors.
- `CHANGELOG.md` with `0.1.0` entry.
- Bundling: `esbuild` (or chosen bundler) produces a single
  `out/extension.js` ≤ ~1 MB. `.vscodeignore` excludes `src/`,
  `.specify/`, tests.
- Activity-bar SVG icon, polished sidebar styling, error-state copy
  reviewed.
- Manual run-through of the README on a fresh checkout to confirm
  the instructions actually work.
- Tag and ship a VSIX (don't publish to Marketplace yet — that's
  a later decision).

### Smoke tests

**4A — Fresh-machine install**
On a machine that has never run AgentBridge: install the VSIX,
follow the README quick-start, get a successful `claude` reply.
Time it. If it takes longer than five minutes, the README needs
work.

**4B — Bundle size**
`ls -lh out/extension.js` is under 2 MB. (Soft cap; Phase 4 should
investigate if it's larger.)

**4C — Lint clean**
`npm run lint` and `npm run typecheck` both pass with no warnings.

### Stop conditions

VSIX produced, README verified, no lint warnings. Tag `v0.1.0`. Open
a PR and stop.
