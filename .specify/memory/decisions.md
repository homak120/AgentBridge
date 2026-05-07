# Architectural decisions

Each decision below is **settled**. Don't reopen one in the course of
implementation work — if you think a decision is wrong, raise it
explicitly with the user and, if accepted, append a new D-entry
recording the change rather than mutating the old one.

New decisions get appended as `D11`, `D12`, etc.

---

## D1 — Express for the HTTP layer

**Decision.** Use `express@^4` for routing and middleware. Mount one
JSON-body parser (`express.json({ limit: "10mb" })`), one error
handler, and one route per file under `src/routes/`.

**Rationale.** Ubiquitous, well-typed, low ceremony. Performance is
not a constraint at localhost scale; readability is. Anyone touching
the project has used Express before.

**Alternatives considered.**
- Fastify — faster, but the throughput we'll see (single client,
  human-paced) doesn't benefit. Extra cognitive load not worth it.
- Bare `http` — lower-level than we want for routing, validation,
  and error handling.

---

## D2 — Tool execution is pass-through only

**Decision.** AgentBridge never calls `vscode.lm.invokeTool` and
never registers a `LanguageModelTool`. Tool definitions arrive from
the client in the request body, are forwarded to the model verbatim,
`tool_use` blocks come back to the client, and `tool_result` blocks
arrive in the next request.

**Rationale.** Clients (Claude Code, Aider) already have tool
runtimes wired to their own filesystem/permissions/UI. Executing
tools inside AgentBridge would duplicate that infrastructure, bind
us to a particular workspace context, and create a confusing trust
boundary. Anthropic's API is itself pass-through; mirroring it keeps
clients working without surprises.

**Implication.** No `LanguageModelTool.contributes` entry in
`package.json`. No `vscode.lm.registerTool` calls anywhere in the
codebase.

---

## D3 — No credential storage

**Decision.** AgentBridge does not read, write, or store any GitHub,
Copilot, or Anthropic credentials. The `x-api-key` header on incoming
requests is required for API-shape parity but its value is discarded.
GitHub authentication is handled entirely by the Copilot extension.

**Rationale.** We are a relay. Storing tokens would be a needless
secret-handling burden and a misleading attack surface — users would
reasonably ask "where are my keys?" and there'd be a bad answer. The
Copilot extension already manages OAuth correctly; we delegate.

---

## D4 — No conversation state across requests

**Decision.** Each `POST /v1/messages` is fully self-contained. The
client sends the entire transcript every time. AgentBridge holds no
state between requests beyond the in-memory activity log used by the
sidebar (cleared on extension reload).

**Rationale.** Matches the Anthropic API exactly, eliminates entire
classes of state-sync bugs (what if the client and server disagree
about history?), and makes restart trivial. Stateless designs also
sidestep the question of where to persist transcripts, which leads
to D3-style credential issues if we ever supported multi-user.

---

## D5 — Lazy activation

**Decision.** The extension's only activation event is
`onView:agentbridge.controlPanel`. No `onStartupFinished`, no
`onCommand:*` activation, no workspace-pattern activation.
`activate()` does **not** auto-start the HTTP server.

**Rationale.** Most users won't have AgentBridge running most of the
time. Activating on startup or command would impose latency and
memory cost on every VS Code session for a feature that's only used
deliberately. The user starts the server when they want to use it.

**Implication.** Every command (`agentbridge.start` etc.) is
registered inside `activate()`, which runs the first time the user
opens the sidebar. Invoking a command from the palette before the
sidebar has ever been opened triggers activation as a side effect —
acceptable.

---

## D6 — Default port 3000, configurable

**Decision.** The server listens on `127.0.0.1:3000` by default. The
port is configurable via the `agentbridge.port` setting. If the port
is in use at start time, surface the error in the sidebar and don't
retry on a different port.

**Rationale.** 3000 is the canonical "local web service" port and
matches the Anthropic SDK examples users are most likely to copy.
Auto-falling-back to a random port would break those copy-paste
examples silently — better to fail loudly and let the user pick.

---

## D7 — Localhost only

**Decision.** The HTTP server binds to `127.0.0.1`. Never `0.0.0.0`,
never an interface IP, never a hostname. There is no setting to
override this and there will not be one.

**Rationale.** AgentBridge has no authentication. A coworker on the
same Wi-Fi pointing their client at our laptop would be using our
Copilot quota with no record of it on our side. Loopback-only is the
defense.

If a user genuinely needs cross-machine access, they can SSH-tunnel
or set up their own reverse proxy with auth. That is explicitly
their problem, not ours.

---

## D8 — SSE for streaming responses

**Decision.** When `stream: true`, the response is `text/event-stream`
emitting Anthropic's documented SSE event sequence
(`message_start`, `content_block_start`, `content_block_delta`,
`content_block_stop`, `message_delta`, `message_stop`, plus `error`).

**Rationale.** It's what Anthropic's public API does, so unmodified
clients (Claude Code, Aider, the official SDKs) consume it without
adapter shims. Any other protocol would be a deliberate
incompatibility.

**Implication.** Set `Cache-Control: no-cache`, `Connection:
keep-alive`, and flush after every event. Detect client disconnect
via the `req.on("close", …)` event and cancel upstream.

---

## D9 — Model exposure & fallback

**Decision.**
- `GET /v1/models` returns the result of
  `vscode.lm.selectChatModels()`, mapped into Anthropic-style
  `{ id, type: "model", display_name, ... }` entries. The `id` we
  return is the same string the user can put in `model` on a
  `/v1/messages` request.
- On `POST /v1/messages`, the `model` field is resolved as: exact
  match first, then case-insensitive prefix match against
  Copilot-provided model identifiers.
- If neither match works, fall back to `agentbridge.defaultModel`
  (set via the sidebar dropdown). If that is null, return 404 with
  a clear message naming the available models.

**Rationale.** Clients hard-code identifiers like
`"claude-3-5-sonnet-20241022"`. Copilot's model identifiers don't
necessarily match. Prefix matching covers most cases without
needing an explicit alias table that we'd have to keep updated.
Falling back to the user's default keeps things working when a
client is configured for an Anthropic model that Copilot exposes
under a slightly different name.

---

## D10 — TypeScript strict; `any` only at the boundary

**Decision.** `tsconfig.json` has `"strict": true` and
`"noImplicitAny": true`. Library code uses precise types throughout.
The only places `any` is allowed are:
- The parsed body of an incoming HTTP request, before runtime
  validation. Once validated, narrow to a typed `MessagesRequest`
  and discard the `any`.
- The `input` field of a tool definition's JSON Schema and the
  `input` of an emitted `tool_use` block. JSON Schema is open-ended
  by design; modelling it in the type system is more friction than
  it's worth.

**Rationale.** Internal types should be load-bearing — they catch
real bugs in the converter, which is the most error-prone part of
the codebase. But forcing every JSON-Schema field through a
hand-rolled `JSONSchemaNode` recursive type is wasted effort for a
relay.

**Implication.** No `any` in `converter/`, `routes/`, `lm/`, or
`ui/` outside the two boundaries above. Reviewers should grep for
`: any` in PRs and push back.

---

<!-- Append D11, D12, etc. here as the project evolves. -->
