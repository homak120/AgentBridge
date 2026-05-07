# AgentBridge

A VS Code extension that exposes GitHub Copilot's licensed LLMs through an
Anthropic-compatible HTTP API on localhost.

> **Status:** Pre-implementation. Specs are in `.specify/specs/`.

## What it does

Point any Anthropic-compatible client at `http://localhost:3000` and use
Copilot's models without separate API keys:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=anything    # required to be set, value is ignored
claude
```

## How it works

```
Client (Claude Code, etc.)  →  AgentBridge proxy  →  vscode.lm  →  Copilot  →  GitHub
```

AgentBridge is a stateless protocol translator. It converts Anthropic
Messages API requests into `vscode.lm` calls, which the GitHub Copilot
extension authenticates and forwards to GitHub's Copilot service. Your
existing Copilot subscription handles billing.

## Constraints

- Localhost only (`127.0.0.1`); never exposed to the LAN.
- Pre-existing Copilot subscription required.
- Tool execution stays on the client side — AgentBridge only relays.
- Personal/research use. Compliance with GitHub Copilot's terms is your
  responsibility.

## Building

This project is built in four phases. See `.specify/specs/04-test-plan.md`.

## License

TBD.
