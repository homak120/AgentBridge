# Changelog

All notable changes to AgentBridge are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-05-07

Initial release.

### Added

- `POST /v1/messages` — Anthropic-compatible Messages API, both
  non-streaming JSON and streaming SSE.
- `GET /v1/models` — lists Copilot models exposed via `vscode.lm`.
- Tool calling: tool definitions and `tool_use` / `tool_result`
  blocks pass through verbatim in both directions, with byte-for-byte
  preservation of `tool_use_id`.
- Sidebar control panel: status pill, start/stop button, endpoint
  display with copy, port input, default-model picker, and a recent-
  activity log.
- Lazy activation. The extension only loads when the user opens the
  sidebar; no startup overhead otherwise.
- Localhost-only HTTP binding (`127.0.0.1`); never bound to other
  interfaces.
- Anthropic-style error envelope (`{ type: "error", error: { type,
  message } }`) on every error path.
- `agentbridge.port` and `agentbridge.defaultModel` settings.

### Notes

- Stateless. No conversation persistence between requests.
- No credentials stored. `x-api-key` is required for API-shape
  parity but its value is discarded.
- AgentBridge does not execute tools. Tool execution stays on the
  client side.

## [Unreleased]

### Added

- Request-detail debug view: clicking an entry in the sidebar's
  recent-activity list opens a webview panel in the editor area with
  request headers/body, response headers/body, per-stage timing,
  and the raw SSE event stream. `x-api-key` is redacted; bodies are
  capped at 256 KB.
- `scripts/smoke.mjs` regression tester wired as `npm run smoke`.

### Changed

- Default port is now **5173** (was 3000). 3000 collided with Open
  WebUI / Next.js dev servers in practice. Override via
  `agentbridge.port`. See decision D11.
