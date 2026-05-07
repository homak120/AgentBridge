# AgentBridge — Claude Code instructions

## What this project is

A VS Code extension that exposes GitHub Copilot's licensed LLMs through
an Anthropic-compatible HTTP API on localhost. External tools (Claude
Code, Aider, scripts) point at `http://localhost:3000` and use Copilot
models without separate API keys.

**Read `.specify/specs/00-overview.md` first.**

## Where to find things

| Topic                          | File                                          |
|--------------------------------|-----------------------------------------------|
| What and why                   | `.specify/specs/00-overview.md`               |
| Component layout               | `.specify/specs/01-architecture.md`           |
| Anthropic ↔ vscode.lm rules    | `.specify/specs/02-protocol-translation.md`   |
| Sidebar UI design              | `.specify/specs/03-ui.md`                     |
| Build phases & smoke tests     | `.specify/specs/04-test-plan.md`              |
| Settled architectural choices  | `.specify/memory/decisions.md`                |

## How to build this project

Follow the four phases in `04-test-plan.md` in order. Each phase has a
smoke test that must pass before moving on.

- **Phase 1**: Scaffold + sidebar shell (no real server)
- **Phase 2**: Real server + auth + minimal handler (text only, no streaming)
- **Phase 3**: Streaming + tool calling
- **Phase 4**: Polish + docs

Work on a branch per phase. Open a PR for review at each phase boundary.
Don't run ahead — if the user asked for Phase 1, stop after Phase 1's
smoke test passes.

## Coding conventions

- TypeScript strict mode. No `any` except at HTTP body boundaries and
  JSON-Schema payloads (see decision D10).
- File-per-concern: one major responsibility per file in `src/`.
- One `*.test.ts` per source module under `src/__tests__/`.
- Errors at the HTTP boundary use the Anthropic error envelope
  (`{ type: "error", error: { type, message } }`), not Express defaults.
- Comments explain *why*, not *what*. Code shows the what.
- Async functions return explicit `Promise<T>` types.

## What not to do

- Do NOT call `vscode.lm.invokeTool` (decision D2 — pass-through only).
- Do NOT register `LanguageModelTool` instances (decision D2).
- Do NOT bind the server to `0.0.0.0` (decision D7 — localhost only).
- Do NOT add `onCommand:` or `onStartupFinished` activation events
  (decision D5 — lazy activation only).
- Do NOT auto-start the server in `activate()` (decision D5).
- Do NOT store any GitHub or Anthropic credentials (decision D3).
- Do NOT persist conversation state across requests (decision D4).

## When in doubt

- Re-read `.specify/memory/decisions.md`.
- If the answer isn't there, ask in chat before assuming.
- New architectural decisions get appended to `decisions.md` with a
  rationale, numbered D11, D12, etc.

## Testing

Tests run with Vitest. Set up in Phase 1 with at least one passing test.

```bash
npm test          # one-shot
npm run test:watch # watch mode
```

`vscode` API is mocked in unit tests. End-to-end tests against real
Copilot are manual (see Phase 3D in `04-test-plan.md`).

## Naming

The project is called **AgentBridge** (one word, capital A and B).
- Extension identifier: `agentbridge`
- Activity bar container ID: `agentbridge`
- View ID: `agentbridge.controlPanel`
- Command IDs: `agentbridge.start`, `agentbridge.stop`, `agentbridge.toggle`
- Configuration namespace: `agentbridge.*`
