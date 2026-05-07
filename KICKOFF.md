# Kickoff prompt for Claude Code

Copy-paste the block below into Claude Code after you `cd` into the
agentbridge repo. Adjust the phase number as you progress.

---

## Phase 1 kickoff

```
Read CLAUDE.md, then .specify/specs/00-overview.md and
.specify/memory/decisions.md.

Then implement Phase 1 from .specify/specs/04-test-plan.md:

- Scaffold the extension structure per .specify/specs/01-architecture.md
- Implement the sidebar webview per .specify/specs/03-ui.md
- ServerController stub that emits state but does NOT actually start an
  HTTP server yet (Phase 2 work)
- Set up Vitest with one passing test
- Verify by F5 launching the Extension Development Host, opening the
  AgentBridge sidebar, and confirming the start/stop button toggles
  the displayed state

Critical:
- Lazy activation: extension must NOT activate on VS Code startup
- activate() must NOT call serverController.start()
- Stop when Phase 1's smoke test in 04-test-plan.md passes

Work on a branch named phase-1-sidebar. When done, summarize what was
built, list any deviations from the spec, and stop.
```

---

## Phase 2 kickoff

```
Phase 1 is merged. Now implement Phase 2 from
.specify/specs/04-test-plan.md.

Re-read .specify/specs/02-protocol-translation.md before you start —
even though Phase 2 doesn't need streaming or tool calling, the request/
response shapes still need to match.

Work on a branch named phase-2-server. Stop when all four Phase 2
smoke tests pass.
```

---

## Phase 3 kickoff

```
Phase 2 is merged. Now implement Phase 3 from
.specify/specs/04-test-plan.md.

This is the phase with the most complexity. The converter and streaming
modules need comprehensive unit tests. Pay particular attention to:
- tool_use_id round-tripping (.specify/specs/02-protocol-translation.md
  "Critical invariant" section)
- Block kind transition logic
- stop_reason derivation

Work on a branch named phase-3-streaming-tools. Stop when all four
Phase 3 smoke tests pass, including the end-to-end Claude Code test (3D).
```

---

## Phase 4 kickoff

```
Phase 3 is merged. Now Phase 4 from .specify/specs/04-test-plan.md —
documentation, polish, and bundling.

Work on a branch named phase-4-polish. The README is the most important
deliverable: a stranger should be able to install and use AgentBridge
from the README alone.
```
