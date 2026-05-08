# AgentBridge

A VS Code extension that lets terminal-native tools (Claude Code,
Aider, scripts) talk to GitHub Copilot's licensed LLMs through an
Anthropic-compatible HTTP API on localhost.

```
Client (Claude Code)  →  AgentBridge proxy  →  vscode.lm  →  Copilot  →  GitHub
        :5173                  (this ext)      (Copilot ext)
```

Stateless. Localhost only. No separate API keys.

## Requirements

- VS Code 1.95 or newer
- An active GitHub Copilot subscription
- The official **GitHub Copilot** extension installed and signed in

## Install

### From VSIX

1. Grab `agentbridge-0.1.0.vsix` from the
   [Releases](https://github.com/homak120/AgentBridge/releases) page.
2. In VS Code, open the command palette and run
   **Extensions: Install from VSIX…**, then pick the file.
3. Reload the window when prompted.

### From source

```bash
git clone https://github.com/homak120/AgentBridge
cd AgentBridge
npm install
npm run build
# F5 in VS Code launches the Extension Development Host with AgentBridge loaded.
```

## Quick start

1. Click the **AgentBridge** icon in the activity bar.
2. (Optional) Pick a default model from the dropdown — used as a
   fallback when an incoming request asks for a model id Copilot
   doesn't recognise.
3. Click **Start server**. The endpoint
   (`http://127.0.0.1:5173` by default) appears.
4. Point your client at it:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:5173
export ANTHROPIC_API_KEY=anything       # required to be set; value is ignored
claude                                  # or aider, or your own script
```

You're in.

## Settings

| Setting                     | Default | What it does                                                  |
|-----------------------------|---------|---------------------------------------------------------------|
| `agentbridge.port`          | `5173`  | Port to listen on. Loopback only.                             |
| `agentbridge.defaultModel`  | `null`  | Fallback Copilot model id when the request's `model` field can't be resolved. |

## How it works

AgentBridge translates Anthropic Messages API requests into
`vscode.lm` calls. The Copilot extension authenticates and forwards
to GitHub. Your existing Copilot subscription handles billing.

It does **not** execute tools. Tool definitions and tool calls flow
client → model → client; AgentBridge is the wire between them.

For the full design — protocol mapping rules, the `tool_use_id`
round-trip invariant, the SSE event sequence, the four build
phases — see `.specify/specs/`.

## Security model

- **Localhost only.** The HTTP server binds to `127.0.0.1`. There is
  no setting to override this.
- **No credentials stored.** `x-api-key` is required (Anthropic
  clients send it) but the value is discarded.
- **No conversation persistence.** Every request carries the full
  transcript.

## Troubleshooting

### "No language models available"

The Copilot extension isn't installed or signed in. Install it from
the marketplace, sign in, then restart AgentBridge from the sidebar.

### "Port 5173 is already in use"

Another process is bound to the port. Either stop that process or
change `agentbridge.port` in settings, then restart the server.

### "I can't reach AgentBridge from another machine"

By design. The server binds to `127.0.0.1` only (decision D7 in
`.specify/memory/decisions.md`). If you genuinely need cross-machine
access, set up an SSH tunnel — `ssh -L 5173:127.0.0.1:5173 host` —
or your own authenticated reverse proxy.

### "Model X isn't recognised"

```bash
curl http://127.0.0.1:5173/v1/models -H "x-api-key: anything"
```

shows the list Copilot exposes. Model IDs vary across Copilot
versions and don't always match Anthropic's exact strings. Fix by:
- changing the request's `model` field, or
- setting `agentbridge.defaultModel` to a Copilot-known id (the
  fallback resolves any unknown model to this).

### Streaming feels chunky

`/v1/messages` with `"stream": true` emits Server-Sent Events the
same way the public Anthropic API does. If your client expects
something else, check that it sends `Accept: text/event-stream`.

## Caveats

- Personal / research use. Compliance with GitHub Copilot's terms
  of service is your responsibility.
- vscode.lm calls count against your Copilot quota the same as
  using Copilot Chat does.
- We expose `agentbridge.port` and `agentbridge.defaultModel`.
  Everything else is hard-wired by design.

## Building & contributing

The project is built in four phases. See `.specify/specs/` for the
specs and `.specify/memory/decisions.md` for settled architectural
choices.

```bash
npm install
npm test          # vitest unit tests
npm run typecheck # tsc --noEmit
npm run lint      # eslint src
npm run build     # → out/extension.js
npm run package   # → agentbridge.vsix
npm run smoke     # regression test against a running server (see below)
```

### Regression smoke tests

`scripts/smoke.mjs` hits a running AgentBridge server and exercises
the wire-level behaviours from `.specify/specs/04-test-plan.md`
(Phase 2 + 3): `/v1/models`, non-streaming, error envelope, missing
auth, streaming SSE sequence, tool-call round-trip with byte-identical
id, mid-stream cancellation. Start the dev host, click **Start
server** in the AgentBridge sidebar, then:

```bash
npm run smoke                                    # default port 5173, model gpt-4o-mini
AGENTBRIDGE_PORT=8080 npm run smoke              # custom port
AGENTBRIDGE_MODEL=claude-haiku-4.5 npm run smoke # different model
AGENTBRIDGE_VERBOSE=1 npm run smoke              # dump every SSE event
```

Exits non-zero on the first failed assertion.

## License

MIT — see `LICENSE`.
