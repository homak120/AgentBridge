#!/usr/bin/env node
// AgentBridge regression smoke tests.
//
// Hits a running AgentBridge server and exercises the wire-level
// behaviours documented in .specify/specs/04-test-plan.md (Phase 2 +
// Phase 3): models endpoint, non-streaming text, error envelope,
// missing auth, streaming SSE sequence, tool-call round-trip with
// byte-identical id, and mid-stream cancellation.
//
// Usage:
//   npm run smoke
//   AGENTBRIDGE_PORT=5173 AGENTBRIDGE_MODEL=gpt-4o-mini node scripts/smoke.mjs
//
// Requires:
//   - Node 18+ (built-in fetch + AbortController + ReadableStream).
//   - lsof in PATH (preflight + binding check).
//   - The AgentBridge dev host running with the server started.
//
// Exits 0 if every assertion passes, 1 if any test fails or the
// server isn't up.

import { spawnSync } from "node:child_process";

const PORT = Number(process.env.AGENTBRIDGE_PORT ?? 5173);
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;
const MODEL = process.env.AGENTBRIDGE_MODEL ?? "gpt-4o-mini";
const VERBOSE = process.env.AGENTBRIDGE_VERBOSE === "1";

const C = {
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m",
};

const results = [];

function ok(name, detail = "") {
  console.log(`${C.green}✓${C.reset} ${name}${detail ? `  ${C.dim}${detail}${C.reset}` : ""}`);
  results.push({ name, pass: true });
}

function fail(name, detail) {
  console.error(`${C.red}✗${C.reset} ${name}\n    ${detail}`);
  results.push({ name, pass: false, detail });
}

function note(s) {
  console.log(`${C.yellow}•${C.reset} ${s}`);
}

async function test(name, fn) {
  try {
    const detail = await fn();
    ok(name, detail || "");
  } catch (e) {
    fail(name, e?.message ?? String(e));
  }
}

// ---------- preflight ----------

function preflight() {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) {
    fail("preflight", `Nothing listening on port ${PORT}. Start AgentBridge in the dev host first.`);
    process.exit(1);
  }
  // Multiple listeners can share a port across IP families (e.g. a Vite dev
  // server on [::1]:PORT and AgentBridge on 127.0.0.1:PORT). Scan every
  // listener row and accept if any binds 127.0.0.1:PORT — that's us.
  const lines = r.stdout.split("\n").slice(1).filter((l) => l.trim().length > 0);
  const target = `${HOST}:${PORT}`;
  const allBindings = lines.map((l) => l.split(/\s+/).find((tok) => tok.includes(":")) ?? "");
  const ours = allBindings.find((b) => b === target || b.startsWith(`${target} `));
  if (ours) {
    const others = allBindings.filter((b) => b !== ours);
    const detail = others.length > 0
      ? `${ours} (also seen: ${others.join(", ")})`
      : ours;
    ok("2C — bound to loopback", detail);
  } else {
    fail("2C — bound to wrong interface", `expected ${target}, got ${allBindings.join(", ")}`);
    process.exit(1);
  }
}

// ---------- helpers ----------

async function postJson(body, headers = {}) {
  return await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": "dummy", "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function collectSse(body) {
  const r = await postJson(body);
  if (r.status !== 200) {
    throw new Error(`HTTP ${r.status}: ${await r.text()}`);
  }
  const ct = r.headers.get("content-type") ?? "";
  if (!ct.startsWith("text/event-stream")) {
    throw new Error(`not text/event-stream (got ${ct})`);
  }
  const text = await r.text();
  return parseSse(text);
}

function parseSse(text) {
  const events = [];
  for (const block of text.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data += (data ? "\n" : "") + line.slice(6);
    }
    let parsed = data;
    try { parsed = JSON.parse(data); } catch { /* leave as string */ }
    events.push({ event, data: parsed });
  }
  return events;
}

function dumpEvents(events) {
  if (!VERBOSE) return;
  for (const ev of events) {
    console.log(`  ${C.dim}event:${C.reset} ${ev.event}  ${C.dim}data:${C.reset} ${JSON.stringify(ev.data).slice(0, 120)}`);
  }
}

// ---------- tests ----------

async function main() {
  console.log(`${C.bold}AgentBridge smoke tests${C.reset}  ${C.dim}${BASE}  model=${MODEL}${C.reset}`);
  preflight();

  // 2A — models endpoint
  await test("2A — GET /v1/models", async () => {
    const r = await fetch(`${BASE}/v1/models`, { headers: { "x-api-key": "dummy" } });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const body = await r.json();
    if (!Array.isArray(body.data) || body.data.length === 0) throw new Error("empty data array");
    const ids = body.data.map((m) => m.id);
    if (!ids.includes(MODEL)) {
      note(`heads-up: requested model "${MODEL}" not in /v1/models list (${ids.join(", ")}). Tests against it may fall back to defaultModel.`);
    }
    return `${body.data.length} models`;
  });

  // 2B — non-streaming text
  await test("2B — POST /v1/messages (non-streaming)", async () => {
    const t0 = Date.now();
    const r = await postJson({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "hi" }],
    });
    const ms = Date.now() - t0;
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const body = await r.json();
    if (body.type !== "message" || body.role !== "assistant") throw new Error("not a message envelope");
    const block = body.content?.[0];
    if (!block || block.type !== "text" || !block.text) throw new Error(`bad content: ${JSON.stringify(body.content)}`);
    if (body.stop_reason !== "end_turn") throw new Error(`stop_reason: ${body.stop_reason}`);
    return `${ms} ms · "${block.text.slice(0, 40)}${block.text.length > 40 ? "…" : ""}"`;
  });

  // 2D — bad body returns invalid_request_error
  await test("2D — bad body returns invalid_request_error", async () => {
    const r = await postJson("{}");
    if (r.status !== 400) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    if (body.type !== "error" || body.error?.type !== "invalid_request_error") {
      throw new Error(`envelope: ${JSON.stringify(body)}`);
    }
    return body.error.message;
  });

  // Auth — missing key returns 401
  await test("Auth — missing x-api-key returns authentication_error", async () => {
    const r = await fetch(`${BASE}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    if (body.error?.type !== "authentication_error") throw new Error(`error.type: ${body.error?.type}`);
    return "401";
  });

  // 3A — streaming text
  await test("3A — streaming text", async () => {
    const events = await collectSse({
      model: MODEL,
      max_tokens: 48,
      stream: true,
      messages: [{ role: "user", content: "Count one to three." }],
    });
    dumpEvents(events);
    const expected = ["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"];
    for (const ev of expected) {
      if (!events.find((e) => e.event === ev)) throw new Error(`missing event: ${ev}`);
    }
    const md = events.find((e) => e.event === "message_delta");
    if (md?.data?.delta?.stop_reason !== "end_turn") {
      throw new Error(`message_delta.stop_reason: ${md?.data?.delta?.stop_reason}`);
    }
    return `${events.length} events`;
  });

  // 3B step 1 — capture tool_use id
  let toolUseId = null;
  await test("3B step 1 — tool_use block emitted", async () => {
    const events = await collectSse({
      model: MODEL,
      max_tokens: 256,
      stream: true,
      tools: [{
        name: "get_weather",
        description: "Get the current weather for a city",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      }],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: "What is the weather in San Francisco?" }],
    });
    dumpEvents(events);
    const start = events.find((e) => e.event === "content_block_start");
    if (!start || start.data?.content_block?.type !== "tool_use") {
      throw new Error("no tool_use content_block_start");
    }
    toolUseId = start.data.content_block.id;
    if (!toolUseId) throw new Error("tool_use block missing id");
    const md = events.find((e) => e.event === "message_delta");
    if (md?.data?.delta?.stop_reason !== "tool_use") {
      throw new Error(`stop_reason: ${md?.data?.delta?.stop_reason}`);
    }
    return `id=${toolUseId}`;
  });

  // 3B step 2 — feed tool_result back with the captured id
  await test("3B step 2 — tool_result round-trip with byte-identical id", async () => {
    if (!toolUseId) throw new Error("step 1 didn't capture id; aborting");
    const r = await postJson({
      model: MODEL,
      max_tokens: 128,
      tools: [{
        name: "get_weather",
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
        },
      }],
      messages: [
        { role: "user", content: "What is the weather in San Francisco?" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: toolUseId, name: "get_weather", input: { city: "San Francisco" } }],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUseId, content: "58°F, foggy" }],
        },
      ],
    });
    if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    const body = await r.json();
    const text = body.content?.[0]?.text ?? "";
    if (!/foggy|58/i.test(text)) throw new Error(`reply didn't reflect tool result: ${text}`);
    return `"${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`;
  });

  // 3C — mid-stream cancellation
  await test("3C — mid-stream cancellation", async () => {
    const ac = new AbortController();
    const t0 = Date.now();
    const timer = setTimeout(() => ac.abort(), 1000);
    let received = 0;
    let aborted = false;
    try {
      const r = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": "dummy", "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 2048,
          stream: true,
          messages: [{ role: "user", content: "Write a long detailed essay about cats." }],
        }),
      });
      if (!r.body) throw new Error("no response body");
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) received += value.length;
      }
    } catch (e) {
      if (e?.name === "AbortError") aborted = true;
      else throw e;
    } finally {
      clearTimeout(timer);
    }
    const elapsed = Date.now() - t0;
    if (!aborted) throw new Error(`stream completed without abort (${elapsed} ms, ${received} bytes)`);
    if (elapsed > 1500) throw new Error(`abort took ${elapsed} ms; expected ~1000`);
    return `aborted in ${elapsed} ms after ${received} bytes`;
  });

  // ---------- summary ----------

  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  console.log();
  if (failCount === 0) {
    console.log(`${C.green}${C.bold}All ${passCount} tests passed.${C.reset}`);
    process.exit(0);
  } else {
    console.log(`${C.red}${C.bold}${failCount} of ${results.length} tests failed.${C.reset}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`${C.red}Unhandled:${C.reset}`, e?.stack ?? e);
  process.exit(1);
});
