# 00 — Overview

## What AgentBridge is

A VS Code extension that runs an HTTP server on `http://127.0.0.1:3000`
and exposes an Anthropic-compatible Messages API. Behind that API it
calls `vscode.lm` — the language-model surface that the GitHub Copilot
extension provides — so external clients can drive Copilot's licensed
LLMs without a separate API key.

```
┌────────────────────────┐    HTTP     ┌──────────────────┐    vscode.lm    ┌────────────────────┐    HTTPS    ┌──────────┐
│ Claude Code / Aider /  │ ──────────▶ │   AgentBridge    │ ──────────────▶ │ Copilot extension  │ ──────────▶ │  GitHub  │
│ scripts (any client)   │             │ (this extension) │                 │ (already installed)│             │ Copilot  │
└────────────────────────┘             └──────────────────┘                 └────────────────────┘             └──────────┘
```

AgentBridge is a **stateless protocol translator**. It has no opinion
about what the client wants to do, executes no tools itself, persists
no conversation state, and stores no credentials. Every request is
self-contained.

## Why it exists

Copilot's Pro/Business plans include access to several frontier LLMs,
but only through the Copilot extension's own UI surfaces (chat, inline
edit, agent mode). Developers who already pay for Copilot want to use
those same models from terminal-native tools. AgentBridge bridges the
two surfaces by speaking the API shape those tools already expect.

## Audience

- Developers who pay for GitHub Copilot and want to use Claude Code,
  Aider, or homemade scripts against Copilot's models.
- Researchers comparing model behaviour without juggling extra API
  keys.

Not for: production deployments, multi-user servers, anything reachable
from outside the host machine.

## Non-goals

- **No auth, no multi-user.** Localhost only, single user, single
  workspace. If you need shared infrastructure, this isn't it.
- **No tool runtime.** Tool calls are relayed in both directions. The
  client executes; AgentBridge passes bytes around.
- **No conversation persistence.** Each request carries the full
  transcript. We never write chat history to disk.
- **No credential management.** The `x-api-key` header is required
  (Anthropic clients send it) but the value is discarded. GitHub auth
  belongs to the Copilot extension.
- **Not a 1:1 Anthropic clone.** We implement the surface area Claude
  Code, Aider, and similar tools actually exercise. Esoteric features
  (batch API, files API, message replay) are out of scope.

## Threat model

The server is bound to `127.0.0.1` and never to `0.0.0.0` or another
interface (decision D7). The threat we care about: another process
running on the same machine making requests. We accept this — anyone
with local code execution can already call `vscode.lm` directly through
their own extension. The threat we do **not** accept: a coworker on
the same Wi-Fi network pointing their client at our laptop.

There is no rate limiting beyond what the Copilot extension itself
imposes. A buggy client can burn through your Copilot quota; that is
the user's problem, not ours.

## Glossary

- **Anthropic Messages API** — the public API at `api.anthropic.com`
  whose request/response shape AgentBridge mimics. Reference:
  <https://docs.anthropic.com/en/api/messages>.
- **`vscode.lm`** — the VS Code language-model namespace. The Copilot
  extension contributes models discoverable via
  `vscode.lm.selectChatModels()`. Reference:
  <https://code.visualstudio.com/api/extension-guides/language-model>.
- **Block** — a typed segment inside an Anthropic message: `text`,
  `tool_use`, `tool_result`, `image`. AgentBridge converts to/from
  these.
- **Pass-through tools** — tool definitions and tool calls flow
  client → model → client. AgentBridge never executes a tool.

## Where to go next

- For component layout: `01-architecture.md`.
- For wire-format conversion rules (the hard part): `02-protocol-translation.md`.
- For the sidebar UI: `03-ui.md`.
- For build phases and smoke tests: `04-test-plan.md`.
- For why decisions were made the way they were: `../memory/decisions.md`.
