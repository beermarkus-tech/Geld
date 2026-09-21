# CLAUDE.md — Read This First

Claude Code reads this file automatically at the start of every session — that's exactly why the project's own reading order lives here: **before touching any code, read `spec.md` first, then `PLAN.md`, then `DEVLOG.md`.** This file itself is just the instructions for how to use those three; it rarely changes and isn't where the project's actual content lives.

## The four documents, and what each one is for

This project is split across four files with four different jobs. Confusing them is the single easiest way to make this project incoherent across sessions, so the boundary matters more than it might seem.

1. **`spec.md`** — the single source of truth for *what the app is*. Every screen, every data model field, every resolved design decision lives here. If spec.md and the running code ever disagree, that is a bug to fix or a decision to escalate — never silently resolve it by trusting the code over the spec.
2. **`PLAN.md`** — the single source of truth for *the intended build order*: staged phases, each with a concrete testable deliverable. Revised when the plan itself changes (a phase gets reordered, split, or rescoped) — similar cadence to spec.md, not appended to every session the way DEVLOG.md is.
3. **`DEVLOG.md`** — the single source of truth for *what has actually happened* during development: what's been built, what broke, what's still undecided, what the next session should pick up. Append-only. Never a diary of hourly progress — one entry per work session, written when the session ends. Entries should reference which PLAN.md phase they correspond to.
4. **This file, `CLAUDE.md`** — instructions for how to use the other three. Rarely changes.

Nothing else is authoritative. If you (Claude Code) generate scratch notes, TODOs in code comments, or intermediate reasoning, none of that carries forward — only what lands in spec.md, PLAN.md, or DEVLOG.md survives to the next session.

## spec.md is not a diary — how it actually gets updated

spec.md changes **only** when a real design decision is made or corrected — never to record that work happened, never to log a bug fix, never as a running commentary. Concretely:

- If, during implementation, you hit a genuine open design question the spec doesn't answer (not a code bug — an actual "what should this behavior be" question), the rule is **ask now if it blocks, log and continue if it doesn't**:
  - **Blocking** — you cannot proceed with the current task without knowing the answer: stop and ask Markus right away, the same way the spec itself was built collaboratively. Do not guess and silently encode the guess into the app. Do not silently decide it yourself and move on.
  - **Non-blocking** — the question is tangential to what's currently being built (it affects a different screen or feature not touched this session): don't interrupt the session for it. Log it as an open item in DEVLOG.md and keep working on whatever isn't affected. Markus answers these at a natural checkpoint — end of session, or next check-in — not one at a time mid-flow.
  - When in doubt whether something blocks: if you'd have to guess at the answer to keep writing the current code, it blocks.
- Once Markus decides, update spec.md to reflect the decision, in the same style and section structure as the rest of the document (plain-language explanation before/alongside the technical shape — see the "Working with Markus" note at the top of spec.md, which still applies to every session, not just spec-writing).
- If implementation reveals the spec was ambiguous, contradictory, or simply wrong about something already marked resolved — that's also a stop-and-ask, then a spec correction, not a silent judgment call.
- Routine implementation choices that don't change the app's behavior or shape as described in the spec (variable names, file organization, which npm package implements a described feature, code-level refactoring) do **not** touch spec.md. Those are just... building the thing the spec describes.

The test: would Markus need to know about this to make his next decision, or to understand what the app now does? If yes, spec.md (as a decision) and/or DEVLOG.md (as a status update). If no, it's normal build noise and belongs in neither.

## DEVLOG.md — what goes in it, and how

One entry per work session (not per commit, not per hour), appended at the end of the file — never edit or delete a past entry, even if it turns out to be wrong; correct it forward in a new entry instead, the way you'd never rewrite history in a shipped changelog.

Each entry should cover, briefly:
- **What was built or changed** this session — which spec section(s) it corresponds to.
- **What's now working vs. still stubbed/incomplete** — an honest state-of-the-build snapshot, not a task list.
- **Anything discovered that needs a decision** but hasn't been resolved yet — genuinely open items, distinct from spec.md's own historical "§4 Open questions log" (that section is for design-phase questions already largely resolved; DEVLOG's open items are implementation-time findings, live until resolved). This is where non-blocking questions land per the rule above — flag each clearly as still awaiting Markus's answer.
- **What the next session should probably do first** — a pointer, not a commitment. Keep this honest and short; if you don't know, say so rather than inventing a plausible-sounding plan.

Format suggestion (adjust naturally, this isn't rigid): a level-2 heading per session with a date, then a few short paragraphs or a tight bullet list under it. Newest entry at the bottom, chronological, like a changelog.

Do **not** use DEVLOG.md for: line-by-line narration of what you typed, restating the spec, or optimism about future sessions. It should read like a competent handoff note to a colleague picking up the project cold — not a transcript.

## Starting a new session

At the start of any session:
1. Skim spec.md's table of contents / section headers to reorient on the app's shape if it's been a while.
2. Read PLAN.md to see which phase is current and what its testable deliverable is.
3. Read DEVLOG.md's most recent 2 to 3 entries to pick up exactly where the last session left off — current state, and anything flagged as still open.
4. If DEVLOG.md flags an unresolved decision that blocks what you're about to do, resolve it with Markus before proceeding, per the rule above — don't quietly pick an answer to keep moving.
5. If DEVLOG.md has accumulated non-blocking open items from a previous session, offer them to Markus now as a batch, in case he wants to resolve any before you continue.
6. If work this session reveals PLAN.md itself needs to change (a phase was wrong, too big, missing something) — that's a PLAN.md edit, following the same "real change, not routine progress" discipline as spec.md, not a DEVLOG entry pretending to be a plan revision.

## Working with Markus (carried over from spec.md — applies here too)

Markus is not a programmer — a solo "vibe coder" who builds by prompting AI and verifying results, not by writing or reading code himself. Never assume familiarity with programming concepts or terminology. Explain in plain terms before asking him to decide something technical. This applies to every session, not just spec-writing — including this one.

## Infrastructure setup — guide him through it, don't hand him a checklist

The first time this project needs Firebase (or any other piece of real infrastructure — a hosting account, a domain, a CLI tool that needs installing) set up, walk Markus through it step by step in conversation rather than listing the steps and leaving him to follow them alone. Concretely: one step at a time, explain what the step does and why it's needed before asking him to do it, wait for confirmation it worked (or for him to paste back what he's seeing) before moving to the next step, and expect to troubleshoot whatever the Firebase console or CLI actually shows him rather than assuming the happy path. This covers things like creating the Firebase project itself, enabling Auth/Firestore/Hosting, setting up the single-admin-UID security rule (§1a/§1b.1 of spec.md), and connecting the local project to it — anywhere the setup leaves the editor and touches an external console, account, or command line is exactly the kind of moment the "Working with Markus" principle above is for, not an exception to it.
