# 01 — Architecture

## Component map

```
                     ┌──────────────────────────────────────────┐
                     │  VS Code extension host                  │
                     │                                          │
     activate() ────▶│  extension.ts                            │
                     │     │                                    │
                     │     ├─ registers webview provider ──────▶│ controlPanel.ts ──┐
                     │     └─ registers commands                │                   │
                     │        (start / stop / toggle)           │                   ▼
                     │              │                           │            (sidebar webview)
                     │              ▼                           │
                     │        serverController.ts ──────────────┼────────▶ server.ts (Express app)
                     │           (state machine,                │              │
                     │            event emitter)                │              ▼
                     │                                          │        routes/messages.ts
                     │                                          │              │
                     │                                          │              ├─▶ converter/requestToLm.ts
                     │                                          │              ├─▶ lm/models.ts ─▶ vscode.lm
                     │                                          │              └─▶ converter/responseFromLm.ts
                     │                                          │                       │
                     │                                          │                       └─▶ converter/streaming.ts
                     └──────────────────────────────────────────┘
```

## File layout

```
src/
  extension.ts                  ← activate / deactivate, command + view registration
  serverController.ts           ← lifecycle + state machine, fires events the UI subscribes to
  server.ts                     ← Express app construction (no listening here)
  routes/
    messages.ts                 ← POST /v1/messages
    models.ts                   ← GET  /v1/models
  converter/
    requestToLm.ts              ← Anthropic request → LanguageModelChatMessage[] + options
    responseFromLm.ts           ← vscode.lm async-iterable parts → Anthropic block stream
    streaming.ts                ← SSE event framing
    types.ts                    ← shared converter types (no any)
  lm/
    models.ts                   ← discovery, mapping Anthropic model id ↔ vscode.lm model
  ui/
    controlPanel.ts             ← WebviewViewProvider
    media/
      controlPanel.html
      controlPanel.css
      controlPanel.js
  util/
    errors.ts                   ← Anthropic error envelope helpers
    log.ts                      ← OutputChannel wrapper
  __tests__/
    *.test.ts                   ← one per source module
```

One major responsibility per file. If a file grows past ~250 lines or
acquires a second responsibility, split it.

## Lifecycle

### Activation

The extension activates **only** when the user opens the sidebar
(decision D5). `package.json` declares `onView:agentbridge.controlPanel`
as the sole activation event. `activate()` does:

1. Register the webview provider (`agentbridge.controlPanel`).
2. Register commands (`agentbridge.start`, `agentbridge.stop`,
   `agentbridge.toggle`).
3. Construct a single `ServerController` and pass it to the provider
   and commands.
4. Push every disposable into `context.subscriptions`.

`activate()` does **not** call `serverController.start()`. The user
starts the server explicitly from the sidebar or palette.

### Server start

`ServerController.start()`:

1. Reads `agentbridge.port` from configuration (default 3000).
2. Builds the Express app via `server.ts`.
3. `app.listen(port, "127.0.0.1")` — never `0.0.0.0` (decision D7).
4. On `listening`, transitions state to `running` and emits.
5. On `error` (EADDRINUSE etc.), transitions to `error` with the
   message and emits.

### Server stop

`ServerController.stop()` calls `server.close()`, waits for in-flight
requests to drain (with a 5 s timeout, then force-close), transitions
to `stopped`, and emits.

### Deactivation

`deactivate()` calls `serverController.stop()` and awaits it. No state
is persisted — restart is a clean slate (decision D4).

## State machine

```
        start()
stopped ────────▶ starting ────▶ running
   ▲                   │            │
   │                   │error       │ stop()
   │                   ▼            ▼
   └─── stop() ──── error      stopping ──▶ stopped
```

Events emitted from `ServerController`:
- `state` — payload `{ state: "stopped" | "starting" | "running" | "stopping" | "error", message?, port? }`
- `request` — payload `{ method, path, status, durationMs, model? }` after each handled request
- `log` — payload `{ level, line }` for the activity log

The webview subscribes to these events through a thin `postMessage`
bridge and renders accordingly. Webview never imports `vscode` directly.

## Request flow (one /v1/messages call)

```
client                AgentBridge                         vscode.lm                 Copilot
  │                       │                                  │                        │
  │── POST /v1/messages ─▶│                                  │                        │
  │                       │ validate headers & body          │                        │
  │                       │ requestToLm(req) ────────────────│                        │
  │                       │                                  │ selectChatModels()     │
  │                       │ ◀──────────────────── model ─────│                        │
  │                       │ chat.sendRequest(messages, opts)─│                        │
  │                       │                                  │── HTTPS ──────────────▶│
  │                       │                                  │ ◀──────────── stream ──│
  │                       │ for await part of response.stream│                        │
  │                       │   responseFromLm.next(part) ────▶│                        │
  │                       │   streaming.emit(event) ─────────│                        │
  │ ◀──── SSE event ──────│                                  │                        │
  │ ◀──── SSE event ──────│                                  │                        │
  │ ◀──── message_stop ───│                                  │                        │
  │                       │ emit("request", …)               │                        │
```

Non-streaming requests buffer the converted block list and return one
JSON response at the end. Same converter; different terminal step.

## What's *not* here

- No persistence layer. No `globalState`/`workspaceState` writes
  outside UI prefs (port, last-selected model). No file I/O for
  transcripts (decision D4).
- No background workers. The extension host event loop handles
  everything; vscode.lm streaming is async-iterable and cooperative.
- No telemetry beyond local logs. The OutputChannel and the sidebar
  activity log are the only places request data goes (decision D3 in
  spirit — we don't ship usage data anywhere).
- No tool runtime. Tools are passed through both directions (decision
  D2). See `02-protocol-translation.md`.
