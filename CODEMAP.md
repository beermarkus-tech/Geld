# CODEMAP.md

A short structural map of the actual codebase — not what the app is (`spec.md`), not the build order (`PLAN.md`), not what happened (`DEVLOG.md`): where things physically live. Updated on real structural change (a new major component, a folder reorganization, a new shared module), not every session — same discipline as `spec.md`, not a diary.

**Currently empty — no code exists yet.** This file starts as a scaffold. The first Claude Code session that creates real project structure (Phase 0, `PLAN.md`) is responsible for filling in the sections below with what actually exists, not what's planned — this file describes reality, always.

Added on external review, Sept 2026: without this, every session re-derives the codebase's shape by reading around it, and across many sessions that's how two components quietly end up doing the same job.

---

## Top-level structure

*(To be filled in once Phase 0 scaffolds the project — directory layout, where components/screens/shared logic live.)*

## Screen-to-component map

*(To be filled in as each screen from spec.md §3 gets built — which file/component owns which screen, so a session working on one screen doesn't accidentally duplicate logic another screen already has.)*

## Shared/pure calculation functions

*(To be filled in starting Phase 1a — `balance()`, the split-transaction invariant, allocation-tag reconciliation, the `Budget` formula, and their tests. These are the functions §4.1 of the external review specifically flagged as needing test coverage — this section should point to both the implementation and its test file for each.)*

## Known duplication or drift to watch

*(Empty for now. If a future session notices two components doing similar things, or a pattern diverging from what's described here, that goes here as a flag for the next session — not silently fixed or silently ignored.)*
