# Devlog

Append-only. One entry per work session, newest at the bottom. Never edit or delete a past entry — if something turns out to be wrong, correct it forward in a new entry. See `CLAUDE.md` for what belongs here versus in `spec.md`.

---

## Session 0 — 2026-09-17 — Spec complete, implementation not yet started

**Status:** No code exists yet. spec.md now has a written section and a matching HTML mockup for every planned screen (Konten, Verlauf, Planung, Prognose, Quickview, Status, Außenstände, Monatsabschluss, Settings, Fortschritt, Dashboard). This is the handoff point from design to implementation.

**What's resolved:** Full data model (§2), navigation shell and global year selector (§1b), and per-screen behavior for all eleven screens (§3a–§3j). See spec.md §4 for the historical design-phase open-questions log — nearly everything there is marked resolved with a cross-reference.

**Genuinely still open (carried forward from spec.md §4, these are implementation-time validations, not design gaps):**
- Konten: phone split-transaction expand/collapse pattern needs real-device validation once buildable.
- Konten: whether a multi-leg transfer chain (allocation tag → bank → investment) needs explicit visual/logical grouping beyond the two-line linking each leg already gets — **resolved (§3a): not wanted, no special chain handling needed.** This discussion surfaced a real, previously-unspecified gap instead — how the two-leg link for a *single* transfer actually gets established at all, given each side can be entered independently (manually or via two separate bank CSVs), possibly weeks apart. **New feature added to spec (§3a): automatic transfer-leg matching** — runs on every save, manual or imported, not just at import time. Same amount/opposite sign/close date across two separately-saved rows gets **suggested** (flagged, one-tap confirm) rather than silently auto-merged — deliberately not automatic, since a coincidental same-amount collision between two unrelated transactions could otherwise merge wrongly. Retroactive matching for a partner leg saved later; manual fallback only when genuinely ambiguous (multiple same-amount candidates).
- Verlauf: tag-linked breakdown-line mechanism needs validation against more real categories once buildable.
- Amazon intra-order item categorization — parked, hard problem, no clean source data from Amazon to work from. Distinct from Amazon returns, which the Außenstände mechanism already covers.
- Fortschritt: the "pick a different tag" selector interaction, and how rendering should look for 3-or-more children or flat (non-hierarchical) categories — **resolved (§3j): plain Kategorie/Unterkategorie two-step selector, no tag-picker — tags found underneath the selection are auto-discovered and rendered as one card each, side-by-side on tablet / stacked on phone; allocation tags explicitly out of scope (treated like sub-accounts, not tracked here). Mockup still needs the selector itself built in — not yet done.**

**Next session should probably:** start implementation — scaffold the React+Vite+Tailwind+Firebase project per §1b.1, wire up Firebase Auth (single fixed UID, §1b) and Firestore, and begin with whichever screen Markus wants built first (Konten is the natural starting point — it's the most-used screen and everything else reads from the data it writes).

### Addendum — same day

- **Resolved:** Konten's saved-filter apply behavior — confirmed **fully replaces** the current filter state rather than merging with it. Already written into spec.md §3a as the default; no spec change needed, just confirming it here since the question was raised after that section was written and never formally closed out.
- **New open item:** Konten's saved-filter question above surfaced a gap — it had been flagged to Markus but never made it into this log, so it sat unresolved with no visible trail. Worth remembering as a reason to log a question here the moment it's asked, not only once it's answered.
- **New open item:** a full **spec consistency/completeness audit** of spec.md is wanted — traceability against §1's requirements, internal cross-reference integrity, terminology consistency, and an edge-case sweep per entity. Deliberately deferred, not urgent; do when Markus asks for it.
- **New open item:** a **stepped development plan** is wanted — breaking implementation into a concrete sequence of stages/milestones (which screens/features in which order, what "done" looks like at each step) rather than one undifferentiated "start implementation" next-step. Not yet drafted.

### Addendum — same day, spec audit performed

**Resolved:** the spec consistency/completeness audit (above) — run this session. Method: cross-reference integrity (every internal `§X.Y` reference checked against real headers — all 182 references across the doc resolved cleanly, no dangling links), terminology/field-name consistency (every field in the `§2` schema blocks checked for stale/contradictory usage elsewhere), and an edge-case lifecycle sweep on §3i (Settings). Three real findings, all fixed in spec.md this session:
1. **Dead field removed** — `linkedTransactionId` (§2.6) had two original purposes (old loan link-picker, multi-leg transfer chains), both since retired/declined; deleted from the schema rather than re-commented again.
2. **Overscroll/pull-to-refresh requirement operationalized** — was stated once in §1's requirements list and never followed up anywhere; added a concrete CSS fix (`overscroll-behavior: none` + `touch-action`) to §1b.1.
3. **Reference-count gap fixed** — §3i's archive/delete reference count was illustrated as transactions + budget lines only; extended to also check allocation tags' `reconciliationTargetAccountIds` (§2.5), since an account can be structurally load-bearing for a tag while having few or no transactions directly against it.

Also confirmed, no spec change needed: merge stays defined identically for both categories and tags (even though category merge has never actually been used in practice) — kept as-is; accounts are deliberately excluded from merge (two real bank accounts are never the same thing by mistake) — now stated explicitly in §3i rather than left as an implicit absence.

Traceability against §1's requirements otherwise held up well — platforms, PWA, offline-first, single-user/multi-device sync, minimal-click workflows, and keyboard control are all substantively addressed elsewhere in the doc, not just listed and forgotten.

### Addendum — same day, Export spec + second sweep

**New section written: §3k Import/Export (Export only — Import was already covered in §3a).** Disaster-recovery purpose only, confirmed explicitly — not a re-import-elsewhere or analysis format. Two exports: a transactions CSV (one parent row per transaction, additional child rows for split lines, `TransaktionsBetrag`/`PositionsBetrag` kept in separate columns so summing the position column never double-counts a split transaction's total), and a full-dataset JSON export covering every hand-authored collection (`transactions`, `categories`, `tags`, `accounts`, `budgets`, `settings`) — deliberately excludes everything derived/computed (§2.8), since that reconstructs itself automatically and isn't data to protect.

**Also added to parked feature ideas (§4):** Gehaltsabrechnungen (payslips) and Geldanlage (investments) — noted only, may never get built.

**Second consistency sweep, two more stale-text fixes:**
1. §2.6's CPAM/travel-expenses paragraph still said "to be discussed in detail" — stale, since §3g resolved this via the generalized Außenstände mechanism. Updated to point there.
2. The App Sections status table's "(various graphs) — not yet discussed" row was stale too — contradicted by §4's own note that every graph is accounted for. Updated with the real cross-references.

**New open item, not yet resolved:** the navigation shell (§1b.2) lists Dashboard, Konten, Verlauf, Planung, Quickview, Fortschritt, Monatsabschluss, Außenstände, Import/Export, and Settings as reachable destinations — **Prognose (§3d) and Status (§3f) aren't in that list**, despite both being fully detailed screens with their own mockups. §3d mentions an "open Prognose" link from Dashboard, implying they're meant to be reachable as their own screens, but nothing states this explicitly, and it's unclear whether Status has an equivalent path. Needs Markus's input: are these two intentionally drill-in-only (reachable only via a link from Dashboard, not top-level nav), or should they be added to the nav list properly?

### Addendum — same day, Dashboard architecture corrected

**Resolved:** the Prognose/Status nav-placement open item from the previous entry. Confirmed by Markus: neither has (or needs) a separate nav-reachable screen — their content *is* Dashboard, not something Dashboard links out to. No change needed to the nav list (§1b.2) — it was never missing anything.

**Dashboard restructured into individual cards, each opening a detail view (§1b.2):** a pinned alerts band above (unchanged) plus a grid of cards below — Prognose's year-progression chart (largest/primary), the yearly balance summary, the fund-location chart, a condensed Status selection (most-deviating categories only), and the existing Quickview doorway. Tapping any card opens its full detail view with more filter/display control than the card shows. This also resolves a real gap: the yearly-balance-summary and fund-location charts (§3d) previously had no actual home — the dashboard mockup's own caption deferred them to "one tap away" into a separate Prognose screen that, per the above, was never actually going to exist. They're now Dashboard cards like everything else. §3d and §3f both updated to state plainly they have no screen of their own.

**Still not designed:** the exact filter/display controls available inside each card's detail view — parked, not blocking.

**Real remaining task, not yet done:** `mockup-dashboard.html` needs a substantial rebuild — it currently only shows the hero chart + condensed Status + alerts + Quickview doorway in a single-page layout, not the new card-grid structure, and is missing the two new charts entirely.

### Addendum — same day, Dashboard mockup rebuilt + infra-guidance instruction added

**`mockup-dashboard.html` rebuilt** to match the corrected card-grid architecture: pinned alerts band unchanged; Prognose card (primary/largest, unchanged chart); two new cards — Jahresbilanz (yearly balance summary, condensed to 4 plain bars) and Geldanlage-Standort (fund-location, condensed to 3 of the real 7 allocation tags); Status trimmed from 6 categories to the 3 most-deviating; Quickview doorway unchanged. Every card's link text now reads "Details ›" (or "Status öffnen ›" for Status) rather than implying a separate Prognose/Status screen. Tablet: Prognose full-width, Jahresbilanz + Geldanlage-Standort side by side below it, then Status, then Quickview. Phone: same content, stacked.

**CLAUDE.md updated** — new section instructing Claude Code to walk Markus through infrastructure setup (Firebase project creation, Auth/Firestore/Hosting, the security rule, connecting the local project) step by step in conversation, not as a checklist to follow alone. Placed in CLAUDE.md rather than spec.md, since this is an instruction about how Claude Code should work with Markus, not a description of what the app is — spec.md wasn't touched for this one.

### Addendum — same day, stepped development plan written

**New file: `PLAN.md`** — resolves the open item from earlier today. Eight phases, staged by data dependency (Phase 0 infra → Phase 1-2 Konten core+import → Phase 3 Verlauf/Planung → Phase 4 Dashboard → Phase 5 Außenstände/Fortschritt/Quickview → Phase 6 Monatsabschluss/Settings/Export → Phase 7 offline/real-device validation), each with a concrete testable deliverable Markus can verify himself. CLAUDE.md updated to read spec.md → PLAN.md → DEVLOG.md at the start of every session, and to treat PLAN.md with the same "real change, not routine progress" edit discipline as spec.md. Session 0's original "next session should probably" line above is superseded in spirit by PLAN.md's Phase 0/1 — left as-is rather than edited, per DEVLOG's own append-only rule.

### Addendum — same day, alerts band confirmed + detail-view timing

**Confirmed:** alerts band stays a separate pinned strip above the Dashboard card grid, not itself a card — matches what was already written, no spec change needed.

**Decision:** Dashboard cards' detail-view filter/display controls stay deliberately deferred to dev-time (Phase 4, PLAN.md) rather than designed now — the underlying data is already fully spec'd (§3d/§3f), what's left is a pure UI-interaction decision better made against a real rendered chart than in the abstract.

### Addendum — same day, Fortschritt mockup updated

**`mockup-fortschritt.html` rebuilt** to match §3j's resolved design — the old tag-search selector (a single field showing a "Schottland" pill) replaced with the actual plain Kategorie → Unterkategorie two-step dropdown selector. Existing Schottland content wrapped in a labeled card (tag pill + its own Budget/Prognose header) rather than sitting directly under the page header, making the "one card per auto-discovered tag" structure visible even with only one populated example. No second example card built (Urlaube only has one real tag this year, and mocking additional child-counts was already declined earlier). Caption rewritten to match.

### Addendum — same day, external Opus review — Section 1 resolved

An independent review by Claude Opus (fresh context, no investment in existing decisions) found five significant issues in Section 1 ("fix before any more code"). All five resolved and written into spec.md/PLAN.md this session. The single highest-stakes technical claim (1.1) was independently verified against current Firestore documentation before acting on it, not just trusted.

1. **Computation model corrected (§2.8, §2.6, §2.9).** Firestore cannot query `lines[]` (array of maps) the way §2.8 assumed, and its aggregation queries (`sum`/`count`/`average`) don't work offline — confirmed against current docs. Fixed: the selected year's transactions load into memory via `onSnapshot`, everything computes client-side. `status` is no longer a stored field (was the exact denormalized-snapshot bug §1a warns against) — now purely computed, same as everything else in §2.8. §2.9's rationale for rejecting E2E encryption corrected to match (no longer cites aggregation queries that don't exist anymore).

2. **Balance double-counting bug fixed (§2.1, §2.3) — Markus's resolution, cleaner than the one proposed:** balances stay all-time (not year-scoped), but the year-end rollover mechanism is corrected from "one opening-balance transaction injected every year" (which double-stated history) to **exactly one, ever**, anchored at the start of the earliest imported year. Every later year's `Jahresanfang`/`Jahresende` become computed lookups against the continuous balance, not stored transactions.

3. **Signed amounts (§2.6).** `amountCents` at both parent and line level can be positive or negative — not "always positive" as previously written, which couldn't represent the spec's own salary-split example (positive Gehalt line, negative Steuern line). Split-transaction invariant and auto-remainder mechanism both unaffected — the arithmetic already worked identically for signed values, only the false "always positive" constraint needed removing.

4. **Partial-settlement close-out added (§3g, §3a).** Net-zero claim closure had no path for a CPAM partial reimbursement, an Amazon restocking fee, or a friend repaying less than the full loan — these would sit open forever. New manual action on Außenstände: "close out," which books the residual as a real categorized expense with the same tag, netting it to zero the normal computed way. The one deliberate manual step in an otherwise fully automatic mechanism.

5. **Historical data migration scoped (PLAN.md Phase 1).** 2025 and 2026 transactions now explicitly part of the Phase 1 migration, not just accounts/categories/tags — resolves several features (regular/lump split, Planung's reference-year column, Jahresanfang) that silently assumed prior-year data existed with no import plan for it. 2025 gets the single Jahresabschluß anchor (per item 2 above); 2026 doesn't.

**Still open from item 5:** whether 2025's `budgets` (Plan0) rows are also part of the migration, or transactions only — transactions alone satisfy the regular/lump-split formula, but Planung's reference-year column specifically needs 2025's own Plan0 to show anything. Waiting on Markus's answer; affects Phase 3's testable deliverable.

**Not yet reviewed with Markus:** Sections 2 ("data model — smaller but real"), 3 ("PLAN.md sequencing"), 4 ("missing from the whole package"), and 5 ("genuinely fine," including the over-engineered-merge flag) of the same review. To be worked through in a future session.

### Addendum — same day, historical migration scope finalized

**Resolved:** both 2025 transactions and 2025's Plan0 budget rows are migrated, not transactions alone — closes the open question from the previous addendum. Deliberate reasoning, not just unblocking a formula: Markus wants to validate the whole app against a full real closed year, so PLAN.md Phase 1 and Phase 3's testable deliverables were both updated to make that the actual test (do computed balances/Verlauf/Planung numbers match the real 2025 Gsheet figures exactly), not just "does manual entry work."

### Addendum — same day, Section 2 of external review — uncontroversial fixes applied

Four items fixed without needing a decision (matched precedent already established elsewhere in the doc, or were plain corrections with no real tradeoff):
- `date` (§2.6) now explicitly a `"YYYY-MM-DD"` string, not a Firestore Timestamp — a Timestamp would drift transactions into the wrong year depending on device timezone.
- New `categorizationRules` collection (§2.7b) — the auto-categorization keyword rules described in §3a had no schema entry anywhere; a rebuild would have silently lost every learned rule. Added to the export list (§3k) alongside `savedFilters`, which was also missing there.
- `isFixkosten` (§2.4) now explicitly acknowledges its retroactive effect on past years' `Budget` figures — same accepted tradeoff already stated for `parentCategoryId` (§3i), just not previously written down for this field too.

Two Section 2 items were already resolved as fallout from Section 1's fixes (the stored `status` bug, §2.9's rationale) — not re-listed here.

**Still open, presented to Markus next:** where category-year attributes (`regularSharePercent`, `pacingMode`, Planung's per-category-year comment) actually live given `budgets` is one document per month — separate collection vs. restructuring `budgets` itself; and the median-split formula's edge cases (zero reference-year total, a refund month pushing the split past 100%, a category with no reference-year data at all).

### Addendum — same day, Section 2 of external review — remaining two items resolved

**Category-year attributes given a real home (§2.7c, new collection).** `regularSharePercent` and `pacingMode` moved out of `budgets` (where they ambiguously sat on "the top-line row" with no defined month) into a new `categoryYearSettings` collection — one document per (category-or-allocation-tag, year), no ambiguity about which of the 12 monthly `budgets` documents they belonged to. `note` stays in `budgets` — genuinely per-month, not per-category-year, no move needed. Chosen over restructuring `budgets` itself into a 12-slot-array shape: cheaper option given the real scale here (a few hundred documents a year, so "fewer documents" isn't solving a real problem), and avoids rippling into the breakdown-line mechanism, Verlauf's grid rendering, and the Plan0 soft-lock, all already extensively specified around the one-document-per-month shape. Markus had no strong preference; this was my call, reasoning given above. Confirmed independent of this decision: Plan0/Plan1 have always been fully separate per year in this schema — year is implicit in `budgets`' `month` field, nothing changed there.

**Median-split formula edge cases resolved (§2.8):** zero reference-year total → both regulärJahr/einmalJahr come out 0. No reference-year data at all → falls back to 100% einmalig ("unproven, not recurring"). A refund/unusual month pushing the split past its normal range (>100% regular, negative einmalig) → **shown as computed, not clamped** — Markus's explicit call: an unusual year is real information, not noise to hide.

**Section 2 of the external review is now fully resolved.** Remaining: Section 3 (PLAN.md sequencing critique), Section 4 (what's missing from the whole package — no tests, no codebase map for Claude Code), Section 5 (genuinely fine, plus one over-engineering flag on Settings' merge operation).

### Addendum — same day, Section 3 of external review — PLAN.md restructured

All five sequencing findings adopted, no real tradeoffs requiring Markus's input — these were plan-quality issues, not data-model decisions. `PLAN.md` rewritten in full:

1. **Offline architecture moved from Phase 7 to Phase 0** — persistent cache, Auth-init timeout, service-worker strategy now set up before any screen is built, not retrofitted after six phases assumed an implicitly-online model. Old Phase 7 survives as a late verification pass, not first contact.
2. **Basic export moved from Phase 6 to Phase 1b**, paired with a rough restore script — a real safety net before Phase 2's CSV import and Phase 7's destructive Settings operations (merge/archive/restructure, all no-undo by design) start touching real data. The polished §3k export + a documented restore procedure stay in (the now-renumbered) Phase 7.
3. **Phase 1 split into 1a (grid, single-line entry, balances, keyboard nav) and 1b (split transactions, tags, basic export)** — isolates the split-transaction mechanism, the most intricate interaction in the app, from the more basic "does the grid work" checkpoint.
4. **Außenstände/Fortschritt/Quickview swapped ahead of Dashboard** — Dashboard's alerts band needs real open-Außenstände data that didn't exist yet under the original order; nothing in the swapped phase depends on Dashboard, so nothing else breaks.
5. **New Phase 4 — parallel-run validation month**, inserted between Verlauf/Planung and the (swapped) Außenstände phase: the app and the real Gsheet run side by side for one real month, every number compared. This directly formalizes what Markus already said he wanted (testing against a full year of real data) and moves the first real confrontation with reality from around old-Phase-6 to right after the core computation engine exists — the cheapest point to fix anything found wrong.

**Full phase count: 9 (0, 1a, 1b, 2, 3, 4-parallel-run, 5, 6, 7, 8)** — renumbered throughout; every cross-reference between phases updated to match.

**Still open:** Section 4 (what's missing from the whole package — no tests, no codebase map for Claude Code) and Section 5 (genuinely fine, plus the Settings-merge over-engineering flag) of the same review.

### Addendum — same day, Section 4 of external review — both items resolved

**New file: `CODEMAP.md`.** A fifth document — where things actually live in the codebase, distinct from what the app is (spec.md), the build order (PLAN.md), and what happened (DEVLOG.md). Starts as a scaffold with no real content, since no code exists yet; the first Claude Code session to scaffold real project structure (PLAN.md Phase 0) is responsible for filling it in. Same update discipline as spec.md — real structural change only, not a session diary. CLAUDE.md updated throughout: reading order now spec → plan → devlog → codemap, file count five not four, new session-start checklist steps to skim it at the start and update it at the end of any session that changes codebase structure.

**Testing discipline added (CLAUDE.md, new section + PLAN.md).** A small test suite over pure calculation functions only — `balance()`, the split-transaction invariant, allocation-tag reconciliation, the `Budget` formula — explicitly not UI testing, which stays Markus's own manual verification per PLAN.md's testable deliverables. Standing rule: any phase that introduces or changes one of these functions adds its test in the same session, not as a later cleanup pass. Specific mentions added to PLAN.md: `balance()` in Phase 1a, the split invariant in Phase 1b, the `Budget` formula in Phase 3 (using the real 2025/2026 figures already in spec.md as ready-made expected values). Allocation-tag reconciliation isn't pinned to one specific phase — covered by the standing rule whenever that logic actually gets built.

**Section 4 of the external review is now fully resolved.** Remaining: Section 5 — mostly "genuinely fine," plus one flag that Settings' merge operation may be more than a single-user app needs.

### Addendum — same day, Section 5 resolved + generic undo designed

**Section 5 of the external review — merge cut (§3i, §4).** Markus's decision, informed by the fuller risk picture (batch rewrite across collections, no undo, no audit trail) that hadn't been explicitly on the table when merge was originally kept: cut entirely for both categories and tags, not just categories. Removed from §3i's operations list (now rename + archive only, not three operations), added to §4's parked ideas — build only if an actual duplicate shows up that can't be lived with via rename/archive alone. Caught and fixed a stale "rename/archive/merge" mention in PLAN.md's Phase 7 that the original spec.md edit had missed. Rest of Section 5 ("genuinely fine") needed no changes — notably, the review called allocation tags replacing envelope accounts "the best decision in the spec."

**External review (all 5 sections) is now fully resolved.**

**New: generic undo, raised by Markus directly, not from the review.** Rejected a true operation-level undo system as more complex than the merge feature just cut for being too risky — the wrong direction to move right after that decision. Four-layer alternative instead, new §2.9a in spec.md:
1. **Firestore PITR**, enabled Phase 0 — whole-database, 7-day, generic safety net (verified as a real current Firestore feature before proposing it, not assumed).
2. **AG Grid's built-in cell-edit Undo/Redo**, Konten (Phase 1a) and Verlauf (Phase 3) — confirmed genuinely free/Community tier by checking AG Grid's own licensing table directly (a third-party comparison page had claimed the opposite — Enterprise-only — and was wrong). `Ctrl+Z`/`Ctrl+Y`, cell edits only, not row add/delete.
3. **Un-archive**, Settings (Phase 7) — cheap, archive never destroyed anything to begin with.
4. **Soft-delete with a ~week recovery window**, Konten transaction deletion (Phase 1b) and Settings' rare true hard-delete (Phase 7) — covers exactly what AG Grid's cell-level undo doesn't (whole-row operations).

PLAN.md updated throughout to wire each layer into the phase where it belongs; Phase 0's testable deliverable now includes verifying PITR is actually enabled in the Firebase console, not just trusting the setup command.

### Addendum — same day, soft-delete recovery mechanism specified

§2.9a's layer 4 previously said soft-deleted transactions were "recoverable" without ever saying how. Fixed: a "Kürzlich gelöscht" toggle in Konten's existing filter bar (§3a), off by default — switching it on surfaces deleted-but-not-yet-purged rows (visually distinct) each with a "Wiederherstellen" restore action. Also made explicit: layer 4 (soft-delete) and layer 2 (AG Grid's cell-edit undo) interact — deleting a row clears AG Grid's entire undo stack by design (row-level changes aren't tracked, only cell edits), so a delete wipes any unrelated undo history that existed before it, separate from whether the deleted transaction itself is still recoverable via the toggle.

### Addendum — same day, mockup-konten.html updated for soft-delete recovery

Added the "Kürzlich gelöscht" toggle (§2.9a) to the filter bar, next to the saved-filters button — off by default. A hidden demo row (a deleted Gartenschlauch/Amazon transaction, struck through and dimmed) appears when toggled on, with a working "Wiederherstellen" button that removes it again — a real interactive demo, not just a static screenshot. Minor polish item from the earlier open-items check; no design change, just brings the mockup in line with what §2.9a already specified.

---

## Session 1 — 2026-09-21/22 — Phase 0 done; Phase 1a migration built and validated

**Phase 0 (PLAN.md) — complete except the tablet check.** Firebase project (Blaze), Google sign-in, Firestore in `eur3` with PITR (verified in the console), single-admin-UID security rule published. React/Vite/Tailwind scaffold with the §1a offline architecture: persistent multi-tab Firestore cache, bounded Auth-init timeout, hand-written network-first service worker (`injectManifest`). **Hosting changed to GitHub Pages** (spec.md §1b.1 updated; Markus's decision). Deployed via GitHub Actions on every push to `main`; a small "Build N" badge (N = commit count) is shown in every app state, and every deploy is reported to Markus by build number. Themed PWA icon. Installed as a PWA on Markus's phone; offline reload verified there. **Still open: the same install/offline check on the tablet.**

**Phase 1a — 2025 migration built, not yet imported.** Seed data (accounts, categories, allocation tags) from spec.md, plus two scripts in `migration/` (see CODEMAP.md) that transform the "Geld 2025" sheet. Every figure is checked against the sheet's own totals, and all match: all account balances, all allocation-tag totals, all claims (open/settled, per receivable account), per-category monthly actuals vs. Verlauf's Prog rows, and Plan0/Plan1 group totals per month. The key modelling finding: the sheet books every row only against its own account and records each transfer twice (once per account, sometimes days apart and with different payee labels), so the migration pairs transfer rows globally and never lets an unpaired row invent money on another account. Several heuristic approaches before that produced plausible-but-wrong balances; the per-account check against the sheet's header formula is what made it reliable.

**Spec clarifications made this session (all driven by the migration):** §2.6 how a two-account transfer's amount applies to each side; §2.8 allocation-tag balances and claim status are signed by the money's direction relative to the tag's target account(s), and claims are routed by who owes the money, not where it was spent; §2.7 budget sign convention (savings-transfer: negative = set aside) and that a budget line's `note` explains that month's booking.

**Data corrections confirmed by Markus** are recorded in `CORRECTIONS` in `transform-transactions.py` (a transfer typo, a claim booked on the placeholder account). One reimbursed expense marked as claimable is now a claim rather than holiday spending (so one category-month differs from the sheet by design). One small investment-loss row in the sheet has no category; it will import as an uncategorized line for Markus to categorize in the app.

**Privacy incident, resolved:** the repo is public (needed for free GitHub Pages). Generated migration output with real personal financial data was committed for a few hours before this was noticed. With Markus's approval, `main`'s history was rewritten and force-pushed so no commit contains it; generated output now lives only in the gitignored `migration/out/`. **Standing rule: no real financial data in this repo, ever.** Consequence for the design: the import screen must not bundle the data into the (public) app — Markus picks the generated files from his device/Google Drive while signed in.

**Open items (awaiting Markus, non-blocking):**
- Year-level side notes in the sheet's Verlauf (why Prog deviates from the plans) have no home in the data model. Not migrated; Markus wants to design something later.
- 2026 transactions: spec.md §2.3 speaks of the migration covering 2025 *and* 2026, while PLAN.md Phase 1a only imports 2025 and has Markus enter a week of 2026 by hand. The "Geld 2026" sheet is in active use (Jan–Sep 2026). Needs a decision on whether/when to migrate it.

**Next session should probably:** build the one-time import screen (file picker → batch writes to Firestore, removed afterwards), import, then start Konten's grid (AG Grid) per PLAN.md Phase 1a.

## Session 1, continued — 2026-09-22 — 2026 so far migrated

**Phase 1a — 2026 migration built and validated, not yet imported.** Markus decided to migrate the "Geld 2026" sheet too (Jan to end of Aug 2026: ~1090 transactions, ~1060 budget rows); PLAN.md updated. Both `migration/` scripts now take the year as an argument (CODEMAP.md). The 2026 sheet's own opening rows are not imported — per spec.md §2.3 there is only the one 2025 Jahresabschluß — so the check is that the 2026 sheet's header comes out of 2025 + 2026 combined. It does: every account, every allocation tag, every claim, the receivables total, Plan0/Plan1 group totals per month, and the savings actuals Jan–Aug. 2025's output is unchanged apart from one budget row pair (below).

**Findings and Markus's decisions:**
- Carry-over differences between the 2025 closing and the 2026 sheet's opening: PayPal (a few cents) — booked as a "Korrektur Übertrag" transaction on 2026-01-01; Bar Markus — the app is right, the sheet still carries the cash payment that session 1 moved onto Bar Markus, so the app stays below the sheet by that amount (shown by the check as an explained difference).
- A 2026 Airbus refund entered without its claim tag gets the tag of the one open claim it exactly settles (Markus confirmed).
- The 2026 sheet names the health-insurance debtor both "CPAM" and "MSH" (sometimes for the same claim); both go to the `cpam` receivable.
- 2026 Plan1 values are partly formula-spread (remaining yearly total over the remaining months), giving sub-cent months. Budget months are now rounded so each row's yearly total stays exactly what Markus typed (this also moved a few cents between months in one 2025 row, whose yearly total is now exact). One 2026 Plan1 block (Ausstattung Sophia) had stale breakdown lines that no longer feed its top line; only the top line is imported, matching what the sheet shows.

**Open items:** the tablet PWA/offline check (Phase 0) and Verlauf year-level notes remain open from the entry above; the 2026-migration question there is resolved.

**Next session should probably:** build the one-time import screen (file picker → batch writes to Firestore, removed afterwards) for all generated files of both years, import, then Konten's grid.

## Session 2 — 2026-09-22 — One-time import screen built

**Phase 1a — import screen built** (`src/ImportScreen.jsx`, wired into `App.jsx`'s authenticated shell — see CODEMAP.md). A multi-file picker classifies each selected file by name (`accounts.json`, `categories.json`, `tags-allocation.json`, `tags-breakdown-{year}.json`, `jahresabschluss.json`, `transactions-{year}.json`, `budgets-{year}.json`), merges same-collection files (2025/2026 breakdown tags overlap and are byte-identical where they do), and batch-writes each collection to Firestore in chunks of 400. Deterministic ids throughout mean re-running it is safe. **Explicitly temporary** — it's Phase 1a's stand-in for a real screen, not a permanent Settings/Import feature (§3k is that, much later); remove it once Markus confirms the import worked and Konten's grid takes over `App.jsx`'s main content.

The ten generated files (both years' seed + migration output) were sent to Markus directly in chat, per the standing privacy rule — never committed, since the repo is public.

**Next session should probably:** confirm the import landed correctly in Firestore (spot-check a few real balances against the app once Konten can show them, or the Firebase console meanwhile), delete `ImportScreen.jsx` and its `App.jsx` wiring, then start Konten's grid (AG Grid) per PLAN.md Phase 1a.

## Session 3 — 2026-09-22 — Import run successfully; Konten's grid + balance() built

**Import confirmed done.** Markus ran `ImportScreen` on his tablet: accounts 27/27, categories 49/49, tags 60/60, transactions 2831/2831, budgets 2065/2065 — every count matched what was sent. **Decision: keep `ImportScreen`'s code rather than delete it**, in case more data ever needs loading the same way; it's no longer the main screen, reachable instead via a "Datenimport" toggle in the header (CODEMAP.md).

**Phase 1a — Konten's grid built** (`src/Konten.jsx`) with a pinned per-`reportingGroup` balance panel and an AG Grid (Community tier) listing the selected year's transactions, both reading live from Firestore. **Confirmed the actual Phase 1a testable deliverable:** every account's Jahresende, computed purely from the imported transactions, matches the real Gsheet closing balance — for both 2025 and 2026 so far. This is the first real use of `balance()`.

**`src/lib/balance.js` + its test suite** (`npm test`, now a required step in the deploy workflow before every build) implement §2.1/§2.3/§2.6/§2.8's all-time balance model. **One deviation from PLAN.md's original wording, logged there and in CODEMAP.md:** the committed test suite uses synthetic fixtures, not Markus's real 2025 figures — a committed test embedding real account balances would break the standing "no real financial data in this repo, ever" rule. This isn't a new open question, just the existing rule's obvious consequence once it came time to actually write the test; real-data validation already exists via the migration scripts' own checks and now doubly via Konten's live panel.

**What's now working vs. still stubbed:** Konten is currently **read-only** — no manual entry yet, no Konto1/Konto2 or Kategorie/Unterkategorie cascading dropdowns, no split-transaction UI (that's deliberately Phase 1b), no keyboard cell-to-cell navigation, no AG Grid cell-edit Undo/Redo. All of that is still ahead within Phase 1a (entry/dropdowns/keyboard nav/undo) and Phase 1b (splitting).

**Found while building, not blocking:** §2.8's "the selected year's transactions are loaded into memory" line and its own `balance()` formula ("over the full loaded history — all-time, not year-scoped") don't quite square with each other — a strict reading of "selected year only" can't compute Jahresanfang, which needs the prior year's closing. Built as: load every transaction ever (not year-filtered) into memory, filter only the *displayed grid rows* to the selected year. At current and foreseeable volume (a few thousand transactions a year, one household) this stays trivial. Flagging in case Markus wants §2.8's wording tightened later — not urgent, doesn't change behavior.

**Known gap to watch:** `ag-grid-community`'s full `AllCommunityModule` bundle pushed the PWA's precached size from ~850 KB to ~2 MB. Still comfortably under the 6 MB cap, but importing only the specific feature modules Konten actually uses would likely cut this a lot — worth doing before the app has many more heavy dependencies stacked on top.

**Open items carried over, still open:** the tablet PWA/offline check (Phase 0); Verlauf year-level side notes (design later, Markus's call).

**Next session should probably:** manual single-line transaction entry in Konten — the Konto1/Konto2 and Kategorie/Unterkategorie cascading dropdowns and the pinned panel updating live off a new row — plus full keyboard cell-to-cell navigation, still within Phase 1a.

## Session 4 — 2026-09-22 — Konten's columns corrected to match §3a exactly

**Fix:** Konten's grid had collapsed Konto1/Konto2 into one combined "Konto" column and showed only Unterkategorie (mislabeled "Kategorie", missing the parent group entirely). Rebuilt to spec.md §3a's confirmed column order exactly: Datum → Konto 1 → (arrow) → Konto 2 → Empfänger → Betrag → Kategorie → Unterkategorie → Details → Tags — including the derived Konto1-primary/Konto2-muted rule and the directional arrow between them (CODEMAP.md updated).

**Open item, raised by Markus, not yet resolved:** §3a's filtering section describes per-column AG Grid filters (single value per field), which works fine for most columns — but not obviously for "show me everything touching account X." Because Konto1/Konto2 are *derived* (§3a's own rule: Konto1 = `fromAccountId` when present, else `toAccountId`), the same real account can land in either column depending on that transaction's direction — a BNP→DKB transfer shows DKB in Konto2, but a DKB→BNP transfer on another day would show DKB in Konto1. A plain "Konto1 == DKB" column filter would miss half of DKB's own history. My proposed resolution, not yet confirmed: a distinct account-level filter (not the same as filtering the Konto1 or Konto2 column directly) that matches a transaction touching the chosen account on *either* side, then displays that row from the chosen account's own perspective — the same signed-by-position amount `Konten.jsx`'s Betrag column already computes, just relative to whichever account is selected instead of always Konto1. This is buildable within AG Grid Community (external filtering is core API, not the Enterprise-gated feature — only multi-select *checkbox* filtering is gated), consistent with §3a's "single value per field" constraint since this would be one additional filter, not a second per-column multi-select. **Needs Markus's confirmation before being written into spec.md** — logged here rather than guessed into the code, since it's a real design decision about what "filter by account" means, not a routine implementation choice.

**Next session should probably:** get Markus's answer on the above, then continue toward manual entry + cascading dropdowns + keyboard nav (still the standing next step from the last two entries).

## Session 5 — 2026-09-22 — Account-filter design confirmed; Konto reverted to one column

**Resolves Session 4's open item.** Markus confirmed the proposed account-filter design (an account-perspective filter, distinct from a plain Konto column filter) is exactly what he wants — and, with that as the real filtering mechanism, said the Konto1/Konto2/arrow three-column split from the previous fix no longer earns its place: he asked to go back to one merged Konto column with the arrow between the account labels. spec.md §3a updated to match (the "Confirmed column order" and "Konto1/Konto2 display rule" text revised in place, with a note on what it supersedes and why — the mockup's split-column layout is now explicitly called out as superseded on this one point; a new bullet under the filtering section documents the account-filter decision).

**Built, not just spec'd:** `Konten.jsx` now has a working account filter — a `<select>` plus click-through from the pinned balance panel — that shows every transaction touching the chosen account (either side) and re-displays Konto/Betrag from that account's own perspective (the counterpart account, amount signed relative to the chosen account). Column order is Datum → Konto (merged) → Empfänger → Betrag → Kategorie → Unterkategorie → Details → Tags.

**Note for whenever manual entry is built:** Konto is still two real fields underneath (`fromAccountId`/`toAccountId`) — merging the *display* doesn't merge the data. How the edit interaction for one merged cell should work (tap to reveal two pickers, or something else) isn't decided; flagged in spec.md itself, not just here, since it's a genuine open point for that later work, not a decision this session made.

**Next session should probably:** continue toward manual entry + cascading dropdowns + keyboard nav — now with the Konto editor's UX still to be decided along the way, per the note above.

## Session 6 — 2026-09-22 — Außenstände split out of Barkonten into its own reportingGroup

**Markus's request:** move the seven `receivable` accounts (Amazon ×4, CPAM, Reisekosten Airbus, Geld verliehen/geliehen) into their own pinned-panel block instead of being folded into Barkonten — they're open claims/loans, not "real accounts" the way a bank or cash balance is. spec.md §2.2 revised: `reportingGroup` gains a fourth value, `"Außenstände"`; the seven accounts' table rows and `migration/seed/accounts.json` updated to match; `Konten.jsx`'s pinned panel now shows four blocks instead of three.

**Noticed while doing this, worth recording:** the Gsheet's own header already shows "Barkonten" and "Verliehen" (Außenstände) as two separate figures (visible in the screenshot Markus shared earlier this session) — so this change arguably brings the reportingGroup grouping *closer* to the Gsheet's own convention, not further from it. The original "fold receivables into Barkonten" decision was a liquidity argument made when the accounts collection was first specced, and was apparently never checked against how the Gsheet itself actually groups these.

**Flagged in spec.md itself, not resolved here (non-blocking — Planung/Prognose aren't built, Phase 3/6):** §3c's Jahresanfang/Budget formula reads `Alle Barkonten`, and its worked "✓" example numbers (5.687 / 14.240 for the two years' Jahresanfang-minus-Puffer) were computed before this revision. Whether "Barkonten" in that formula should now exclude receivables too (probably yes, matching the Gsheet) needs an explicit re-check against real numbers before Planung ever gets built — flagged inline in §3c itself so it isn't missed later.

**Action needed from Markus, not yet done:** `accounts.json` already lives in Firestore from the earlier import — editing the seed file alone doesn't change what's already there. He needs to re-run `ImportScreen` (kept for exactly this) with the updated `accounts.json`, sent again this session. Re-importing just that one file is enough; every other collection is untouched.

**Next session should probably:** confirm the re-import landed (Außenstände block should show real data, and the Barkonten total should drop by the open-claims amount), then continue toward manual entry + cascading dropdowns + keyboard nav — still the standing next step.

## Session 7 — 2026-09-23 — Fixed: phone screen couldn't scroll past the panel

**Bug, reported by Markus on phone:** the accounts panel filled the whole screen and nothing could scroll. Real cause, not just "phone polish missing": `App.jsx`'s `main` was `overflow-hidden`, relying on the AG Grid's own internal scroll (`flex-1`/`min-h-0`) to reach everything below the pinned panel. That works fine at tablet width, where the panel is a short 3-4 column row — but the panel now stacks to four tall blocks on a narrow phone screen (Barkonten alone lists ~17 accounts), taller than the viewport, and `overflow-hidden` trapped it with no way to scroll down to the grid at all. Fixed: `main` is `overflow-y-auto`, and the grid has a fixed height (`h-[70vh]`) instead of depending on a bounded flex parent. The whole page now scrolls normally on any width.

**Answered directly, not ignored — Markus gave an explicit out ("if too early, ignore") but this wasn't a "too early for phone" situation, it was content becoming genuinely unreachable, which is a basic robustness bug regardless of device.** What's still genuinely not built, and *is* legitimately "too early": §1b.7/§3a's actual phone-specific condensed layout (fewer columns, tap-to-expand cards instead of the full grid). Konten today is the same grid+panel at every screen width, just reflowing — usable, not yet phone-optimized. Flagged in CODEMAP.md so it isn't mistaken for done.

**Next session should probably:** continue toward manual entry + cascading dropdowns + keyboard nav — still the standing next step across several entries now.

## Session 8 — 2026-09-23 — Manual transaction entry built (Phase 1a's last piece)

**Konten is now editable, not just a viewer.** "+ Neue Buchung" creates a blank transaction that appears live via `onSnapshot`; every column except Kategorie (pure derived display) can be edited in place, persisting with one `setDoc` per cell commit. New files `src/KontoEditor.jsx` and `src/CategoryEditor.jsx` (CODEMAP.md has the full breakdown) — both small popup editors rather than native AG Grid cell types, since Konto isn't a plain field (it's derived from two account ids) and Kategorie/Unterkategorie is a cascading pair.

**Resolves an open point spec.md itself flagged (Sept 2026, Session 5):** "exactly how editing a merged Konto cell works... isn't decided." Decision made and built: tapping the cell opens one popup with two pickers (Von/Nach), not two separate grid columns. Not written back into spec.md as prose — this felt like exactly the kind of implementation-level interaction choice §3a's own note already anticipated being made freely at build time, not a design decision needing Markus's sign-off the way the Konto1/Konto2-vs-merged question itself did. Flagging here in case that judgment call should be revisited.

**Deliberately simplified, flagged rather than silently accepted as final:**
- **Tags edit as plain comma-separated text.** The real mechanism (§2.5 — inline autocomplete, allocation vs. grouping class, claim-category sequencing) is its own real feature, not attempted here.
- **Editing is all-or-nothing while the account filter is active — disabled entirely, not partially.** Konto/Betrag's displayed meaning changes under a filter (relative to the filtered account, not the row's own primary side); rather than support editing under two different sign conventions, editing just requires "Alle Konten" first. Revisit if this turns out to be annoying in practice.
- **No transfer-leg auto-matching yet** (§3a's "suggest, don't silently merge" mechanism) — entering one side of a transfer today just makes an ordinary single-sided row; the other leg has to be entered and matched by hand (in practice: pick the same two accounts on the Konto editor directly, no suggestion flow). This is real, separate work — not attempted this session.
- **AG Grid's cell-edit Undo/Redo is turned on, but not independently verified against the Firestore-backed persistence** — `Ctrl+Z` should replay through the same `valueSetter`/`onCellValueChanged` path per AG Grid's own docs, but this hasn't actually been tested against a real Firestore round-trip yet. Worth Markus trying deliberately.

**What's now genuinely testable, per PLAN.md Phase 1a's own deliverable text:** "Markus can manually enter a week's worth of real 2026 transactions on tablet, with the pinned balance panel continuing seamlessly... and full keyboard navigation working throughout." Keyboard nav is AG Grid's native behavior, free once cells are editable — no extra work needed there.

**Next session should probably:** have Markus actually enter some real transactions and report back — this is the first time Phase 1a's core loop (enter → categorize → see the balance panel move) is real enough to exercise end to end. Phase 1b (split transactions) is the natural next phase after that holds up.

## Session 9 — 2026-09-23 — Six usability fixes to manual entry, and a real rethink

Markus tried the new manual-entry feature and came back with six concrete points. All six landed:

1. **"Neue Buchung" now inserts below the selected row**, using its date, instead of always defaulting to today/year-start — so entering several real transactions from the same day/period keeps them together instead of scattering. Falls back to the old default when nothing's selected. Row selection enabled on the grid for this (click a row to select it — not a bulk-actions feature, just this).
2. **Konto and Kategorie/Unterkategorie's popups now have explicit Übernehmen/Abbrechen buttons** — relying on blur/Escape alone to commit or cancel wasn't obviously discoverable, especially on a touch device.
3. **The Kategorie column opens the same cascading picker as Unterkategorie now** — previously only Unterkategorie did.
4. **Row delete built**: a small trash-icon column, two-click confirm (click arms it for 4 seconds with a warning icon, a second click deletes). **This is a real hard `deleteDoc`, not spec.md §2.9a's planned soft-delete-with-recovery-window** — that's explicitly Phase 1b work. Firestore's PITR (7-day rolling window, on since Phase 0) is the actual net underneath this for now, not an in-app undo. Worth remembering that a deleted row is Firestore-console/PITR-recoverable, not a click away, until Phase 1b lands.
5. **Columns can no longer be dragged to reorder or hidden** (`defaultColDef={{ suppressMovable: true }}`; Community edition never had a hide-columns panel in the first place — that's an Enterprise module we never registered).
6. **Clicking a pinned-panel group heading (Barkonten/Sparkonten/Geldanlage/Außenstände) now resets the account filter to "Alle Konten."** There's no group-level filter (only single-account), so this is a plain "back to all" shortcut, not a new filtering mode.

**Point 7 was "rethink the editing-disabled-while-filtered restriction, explain your reasoning" — this was a real design mistake, not just a UX preference, and it's fixed, not just explained.** The original reasoning: Konto and Betrag *display* relative to whichever account you're filtered to, not necessarily the row's own `fromAccountId`, so editing them while filtered seemed ambiguous — solved (over-cautiously) by disabling *all* editing while any filter was active, even for columns with zero filter-dependence (Datum, Empfänger, Details, Tags, Kategorie/Unterkategorie). Rethinking it: both supposedly-ambiguous cases were actually already well-defined. Konto's editor was never filter-aware in the first place — it always read/wrote the real `fromAccountId`/`toAccountId` regardless of what the cell displayed. Betrag only needed its `valueSetter` to use the same "reference account" its `valueGetter` already used (the filtered account, or Konto1 when unfiltered) to interpret the typed sign — a small, direct fix, not a new design. So the blanket restriction was solving a narrower problem than it appeared to and doing so far too broadly. Fixed: editing now works identically regardless of filter state. This is also just more useful — filtering to one account is exactly when you're most likely reviewing and fixing that account's own entries, so the old restriction was working against the feature's own purpose.

**Next session should probably:** have Markus keep using manual entry for real (the point of Session 8) now that these frictions are gone, and report back before Phase 1b (split transactions) starts.

## Session 10 — 2026-09-23 — Filtered Konto column now actually shows the arrow

Markus described his mental model of the filtered Gegenkonto column and it was mostly right about the sign convention already — but the display hadn't caught up: filtered mode showed the counterpart account's plain name with no directional glyph at all, only Betrag's sign conveyed direction. Added it: `→ {other}` when the filtered account is the outflow side (Betrag negative), `← {other}` when it's the inflow side (Betrag positive) — same direction convention as the unfiltered Konto column's arrow, just read from the filtered account's own side instead of always left-to-right.

**Confirmed for the record (Markus's understanding, now verified against the code):**
- **Unfiltered:** for any two-account transfer row, the arrow always reads fromAccountId → toAccountId (never flipped), and Betrag is always negative — because Betrag there is signed relative to Konto1, which for a transfer is always `fromAccountId` (the outflow side).
- **Filtered:** arrow points right (→) and Betrag is negative when the filtered account is the outflow side; arrow points left (←) and Betrag is positive when it's the inflow side.

**Next session should probably:** still get real usage feedback on manual entry (standing item from Sessions 8-9) — this was a quick, well-scoped fix in between.

## Session 11 — 2026-09-23 — Stale cells when switching filters directly, and the "Datum 2 / Betrag 1" mystery

**Bug, screenshotted by Markus: switching the account filter directly from one account to another (e.g. Bar Markus → Bar Julia) left Konto/Betrag showing stale, wrong values** — Betrag as 0,00 for real transactions, Konto showing the wrong direction — even though the header, dropdown, and which rows appeared were all already correct for the new filter. Root cause: Konto's and Betrag's `valueGetter`s read `accountFilter` from a React closure, and AG Grid's own change detection is keyed on row-data identity, not on "did some external value a valueGetter depends on change." A `columnDefs` update alone doesn't reliably make the grid re-run `valueGetter`s for rows it already had cached from the previous filter — a known AG Grid gotcha whenever a valueGetter closes over outside state. `centsToEuro(null)` silently printing "0,00" (`null / 100` coerces to `0` in JS) masked what would otherwise have been an obvious `NaN`. Fixed: `api.refreshCells({ force: true })` explicitly on every `accountFilter` change.

**Second question, same screenshots: "what are those columns?" — Datum showing a "2" and Betrag a "1" next to their sort arrows.** Not hidden/duplicate columns — AG Grid's multi-column sort priority badges. Cause: the Datum column had `sort: 'asc'` hard-set directly in its colDef, which behaves as a permanent, sticky sort criterion rather than just an initial default — so clicking Betrag's header to sort by amount added it as a *second* sort criterion on top of Datum instead of replacing it. Fixed: moved the initial date-ascending sort to the grid's `initialState` prop instead (applies once on load, then gets out of the way) — clicking any column header now does a normal single-column sort/replace, the way it's supposed to.

**Next session should probably:** still get real usage feedback on manual entry (standing item, Sessions 8-10) — both of today's fixes came from Markus actually using it, which is exactly the point.

## Session 12 — 2026-09-23 — Eight more fixes from real usage, and keyboard nav deliberately deferred

Markus kept using manual entry for real and found eight more issues. Six were concrete bugs/gaps, fixed; the seventh (a full keyboard-only chained-popup flow) is deliberately deferred, and the eighth is a standing note to revisit keyboard navigation as a whole once the app is more built out.

**Fixed:**
1. **The ← / → arrows in the filtered Konto column were visibly different sizes** — two different Unicode characters (`→`/`←`) render at different widths in the grid's font. Now a single glyph, CSS-mirrored (`scaleX(-1)`) for the opposite direction, guaranteeing identical shape — via a `cellRenderer` reading the transaction directly rather than parsing the `valueGetter`'s string.
2. **The delete trashcan was half-covered by the grid's own scrollbar** — it used `lockPosition: 'right'`, which only stops drag-reordering *within* the scrollable area; it doesn't move the column outside that area. Changed to a genuinely `pinned: 'right'` column, which AG Grid renders outside the scrollable body, immune to the scrollbar.
3. **Picking a date needed an extra confirmation tap on top of the OS picker's own "Fertig"/"Done."** New `src/DateEditor.jsx` — a plain `<input type="date">` that calls `stopEditing()` the instant its value changes, so only the OS's own unavoidable step remains.
4. **Arrow-key navigation in the account filter dropdown jumped across reportingGroup boundaries purely alphabetically** (Consors straight to CPAM). The options are now grouped with `<optgroup>` per reportingGroup, so arrow keys stay within one block, matching how the pinned panel above already reads.
5. **"+ Neue Buchung" now scrolls to and starts editing the new row's Datum cell** once it actually lands (there's a real Firestore round-trip before the row exists to focus, handled via a pending-id ref + an effect watching `rows`).
6. **The keyboard Delete key now does the same thing as clicking the trashcan** — same two-click-style arm/confirm, routed through the same `handleDeleteClick`, ignored while a cell is actively being edited so it doesn't interfere with normal text editing.
7. **Übernehmen wasn't applying the selection at all** — a real, confirmed bug, not a misunderstanding. Root cause: AG Grid's own "click outside the popup" listener fires on `mousedown`, which runs *before* a button's `onClick` — it was racing Übernehmen's click and cancelling the edit first, discarding whatever was selected. Fixed with `onMouseDown={(e) => e.stopPropagation()}` on both popup editors' root element, stopping that event from ever reaching AG Grid's document-level listener.

**Deliberately not attempted — logged instead of guessed at:** Markus described a precise fully-keyboard-driven flow — Enter on a focused Konto/Kategorie cell should open the popup with its first list *already expanded*, arrow+Enter should move straight into the second list already expanded, and the second Enter should apply and return focus to normal grid navigation, with no mouse involved at any point. This is real, well-specified future work, not something to half-implement now: the "auto-open a native `<select>`'s dropdown programmatically" piece specifically depends on `HTMLSelectElement.showPicker()`, whose browser support is genuinely inconsistent — notably uncertain on iPad Safari, which is Markus's actual device. Building this now risked shipping something that silently doesn't work on his own tablet. **Markus separately asked, explicitly: review the complete keyboard navigation once the app is fully built, rather than perfecting it piecemeal per-screen.** This item — the exact chained-popup flow described above — is the concrete first thing that review should cover, recorded here so it isn't lost by then.

**Next session should probably:** keep gathering real usage feedback on manual entry — every fix this session and the last two came directly from that.

## Session 13 — 2026-09-23 — Übernehmen's real cause found; three more real bugs from usage

Markus reported four more issues after Session 12's fixes deployed. One (Übernehmen) turned out to need a proper root-cause dig — Session 12's fix for it was wrong.

**Übernehmen still wasn't applying — traced properly this time.** Read AG Grid's actual source (`ag-stack`'s `BasePopupService`) rather than guessing again: the "click outside the popup, cancel the edit" listener Session 12 targeted with `onMouseDown` stopPropagation only attaches when the popup is `modal`, gated by the grid option `stopEditingWhenCellsLoseFocus` — which this grid never sets, so it defaults `false`. That mechanism was **never even active**; stopping its event genuinely could not have been the fix, and wasn't — the bug was still there. Real fix: stopped routing Übernehmen through AG Grid's `getValue()`/`stopEditing()` commit pipeline at all. `Konten.jsx` now has small module-level `applyKontoDirect`/`applyCategoryDirect`/`applyDateDirect` functions (persisting via a shared `persistTx`), passed to each popup editor via `cellEditorParams.onApply`; Übernehmen calls `onApply` directly, then `api.stopEditing(true)` (cancel — already persisted, so AG Grid's own commit pipeline never runs at all for this button, so whatever was actually wrong with it doesn't matter anymore). Column `valueSetter`s stay in place as a fallback for other ways an edit might end, but nothing load-bearing depends on them working now.

**Date field needed three interactions (click → double-click → third tap for the calendar).** Two separate causes, both real: (1) AG Grid defaults to double-click-to-edit, which applies to every column, not just Datum — `singleClickEdit={true}` fixes it grid-wide. (2) Focusing a date input doesn't itself open its calendar UI on most platforms — `DateEditor.jsx` now calls `input.showPicker()` (best-effort, wrapped in try/catch) the instant it mounts. `DateEditor` also switched to the same direct-`onApply` pattern as the other popups, both for consistency and because its `onChange`-triggered `stopEditing()` used the same pipeline that turned out unreliable for Übernehmen.

**Trashcan still reported covered by the scrollbar** — no fresh screenshot this round to confirm whether this was pre- or post- Session 12's `pinned: 'right'` fix (which is AG Grid's documented, correct mechanism for exactly this). Left as-is; asked Markus to reconfirm on the current build rather than guess at a second theory without evidence the first one didn't work.

**New regression: arrow-key navigation in the pinned panel.** After Session 12's `<optgroup>` fix (which fixed the `<select>` itself), Markus's screenshot showed a focus outline sitting on the "Bar Markus" panel button with arrow keys doing nothing useful. Real cause: the pinned panel's account rows are plain `<button>`s (added as click-shortcuts to the account filter, an earlier session) — clicking one focuses it, but plain buttons have no built-in arrow-key behavior the way a `<select>` does. Added roving ArrowUp/ArrowDown navigation between sibling buttons within one reportingGroup's `<ul>`, matching the same "stay within one block" behavior the dropdown already has.

**Next session should probably:** get Markus's confirmation on the trashcan/scrollbar specifically (the one item without a fresh screenshot this round), then keep gathering real usage feedback — this is now four sessions running purely on real bugs Markus found by actually using it, which is exactly working as intended.

## Session 14 — 2026-09-23 — New row wasn't marked selected

**Fix:** "+ Neue Buchung" focused and started editing the new row's Datum cell, but never actually selected it (the blue row-selection tint), only cell-focused it. Added `node.setSelected(true, true)` alongside the existing focus/edit-start calls — also means a second "+ Neue Buchung" right after correctly chains below the row that was just added, since selection is what "insert below" reads.

## Session 15 — 2026-09-23 — Five more fixes: new-row focus, delete gray-out, panel arrow behavior, row-follows-focus

**1. New row was starting edit mode immediately (opening the calendar) instead of just landing cell-focused.** Removed `startEditingCell` from the "+ Neue Buchung" focus effect — it now only scrolls to, selects, and cell-focuses the new row's Datum cell, ready for a single tap/Enter (per `singleClickEdit`) to actually open the picker.

**2. Delete now grays out the whole row while armed, and Escape discharges it.** `getRowClass` applies `opacity-40 grayscale` when `confirmDeleteId` matches the row, paired with a `redrawRows()` effect on `confirmDeleteId` changes (`getRowClass` alone isn't re-evaluated for already-rendered rows just because unrelated React state changed elsewhere). A global `keydown` listener clears the armed state on Escape, active only while something is actually armed.

**3 & 4. Panel arrow-key navigation now applies the filter as you move, and Left/Right jump between the four group boxes.** Session 13's roving-focus fix only moved the focus rectangle, matching what was literally reported at the time ("arrow navigation broken") but not actually what was wanted, which turned out to be closer to the `<select>`'s own behavior: arrow keys should change the selection live, not just move a cursor. ArrowUp/Down now calls `setAccountFilter` directly as focus moves within one reportingGroup's `<ul>`; ArrowLeft/Right jumps to the first account of the adjacent group (Barkonten → Sparkonten → Geldanlage → Außenstände, fixed order) via each panel `<div>`'s new `data-group` attribute and plain DOM sibling traversal.

**5. Row selection (the blue tint) now follows keyboard cell focus, not just clicks.** `onCellFocused` selects whichever row the cell cursor lands on. Markus's stated reasoning — "it will be clearer to know which row is selected" — is also functionally useful: "+ Neue Buchung"'s insert-below-selected-row now correctly follows arrow-key navigation, not only the last mouse click.

**Trashcan/scrollbar — still reported (screenshot showed the delete column present but didn't clearly resolve whether it's still visually cut off).** No further scrollbar-overlap theory beyond Session 12's `pinned: 'right'` fix, which is architecturally correct per AG Grid's own docs; widened the column from 44px to 52px as a safety margin against any icon/padding-level clipping, distinct from the scrollbar-overlap question. Needs a tight, zoomed-in screenshot of just that corner to diagnose further if it's still wrong — a full-screen screenshot makes a few-pixel clipping issue hard to see either way.

**Next session should probably:** get a close-up look at the trashcan corner specifically if it's still off, otherwise keep gathering real usage feedback — five sessions running now purely on real issues found by using the app for real.

## Session 16 — 2026-09-23 — Three quick fixes: shortcut, red not grey, Escape in the panel

**1. Ctrl/Cmd+'+' now triggers "+ Neue Buchung"**, skipped while a cell is being edited. Flagged, not hidden: Ctrl/Cmd+'+' is the browser's own zoom-in shortcut everywhere, and browsers commonly refuse to let a page override it — this listens for it regardless, but may not fire reliably on every platform for reasons outside the app's control.

**2. Armed-delete tint is red now, not grey.** Added `--color-alert-tint` (a new light/dark token in `index.css`, distinct from `--color-alert` itself — a muted background, not the alert text color) and switched from `getRowClass`/opacity-grayscale to `getRowStyle` with that token.

**3. Escape while navigating the pinned panel resets to "Alle Konten" and hands focus back to the grid**, landing on the Datum cell of whichever row is roughly mid-viewport (`getFirstDisplayedRowIndex`/`getLastDisplayedRowIndex`, averaged) — deferred a tick, since clearing the filter changes the row set and the grid only re-renders with the larger, unfiltered list after the handler returns.

**Markus confirmed the panel's arrow-key navigation itself (Up/Down/Left/Right) now works well** — Session 15's fix held.

**Next session should probably:** still watching for confirmation on the trashcan/scrollbar corner (Session 15's open item) — otherwise keep going on real usage feedback.

## Session 17 — 2026-09-23 — The keyboard-chain flow, built after reconsidering the earlier "too risky" call

Markus pushed back directly on Session 12's deferral: "why do you not want to try the chain?" — a fair challenge, and worth re-examining rather than repeating the earlier reasoning. It turned out the earlier call was based on conflating two different things.

**The actual re-think:** the concern back in Session 12 was `HTMLSelectElement.showPicker()` — the API for programmatically popping a `<select>`'s dropdown list open — whose browser support genuinely is inconsistent, notably on iPad Safari (Markus's actual device). But the described flow doesn't need that at all: a `<select>` that merely has **focus** (no visual dropdown open) already responds to arrow keys by cycling its value directly and firing `onChange` — plain, rock-solid, decades-old `<select>` behavior with zero cross-browser risk. The earlier deferral was treating "keyboard-navigable" and "visually popped open" as the same requirement when they aren't. Built now:

- **`KontoEditor.jsx`, `CategoryEditor.jsx`, `DateEditor.jsx`** all auto-focus their first `<select>` when the popup opens (`afterGuiAttached`), and each `<select>`'s Enter key moves to the next one in the chain (Von→Nach, Kategorie→Unterkategorie, Tag→Monat→Jahr), with Enter on the last one calling the exact same `apply()` function as clicking Übernehmen. Matches Markus's described flow precisely: cursor on the cell → Enter → arrow through the first list → Enter → arrow through the second (dependent) list → Enter → applied, back to normal grid arrow-key navigation (AG Grid's own default behavior once the editor closes).

**Fixed as a side effect, not the main point: the date field's two-click problem.** Rebuilt `DateEditor.jsx` from a native `<input type="date">` into three plain `<select>`s (Tag/Monat/Jahr), same visual family as the other two popups. This wasn't just for the keyboard chain — it directly explains why Datum needed two taps where Konto/Kategorie only needed one: a `<select>` always opens on a single tap everywhere, guaranteed; a native date input's calendar overlay needs `showPicker()` to open without a second tap, and that call's browser-enforced "must come from a real user gesture" requirement wasn't holding up reliably through AG Grid's own edit-start sequence. Matching the other two editors' mechanism sidesteps that instead of chasing it further. Year range is a fixed, generous −5/+2-around-today window, not just the current year, so historical corrections stay reachable.

**Also added: Ctrl/Cmd+K jumps into the account filter.** Focuses the active filter's own panel button if one is set (handing straight into that panel's richer roving-arrow-key navigation from Sessions 15-16, including live-apply and Escape-back-to-grid), or the plain `<select>` if nothing's currently filtered.

**Next session should probably:** get Markus's read on whether the full chain actually feels right in practice now that it's built — this was speculative-but-well-reasoned, not yet used for real.

## Session 18 — 2026-09-23 — Ctrl+K clarified, Datum simplified to plain text, native selects replaced

Three substantial follow-ups from Markus's specific feedback.

**1. Ctrl+K should always land in the pinned panel, never the plain `<select>`.** Previous version fell back to the `<select>` when no filter was active. Now: always the panel's account boxes (the active filter's button, or the first account overall if none). Added Enter as a third key there, alongside Escape: Enter keeps the highlighted filter (Escape clears it to "Alle Konten") and *both* now hand focus back to the grid, landing mid-viewport — the shared logic is factored into `focusGridMidViewport()`. Markus's own framing: Ctrl+K → arrow → Enter → Ctrl+K again is a closed loop back to the same spot.

**2. Datum is a plain text cell now, no picker of any kind.** Session 17's three-`<select>` popup was a real improvement over the native date input, but Markus didn't want a popup here at all — just type into the cell like Empfänger or Details. `parseFlexibleDate()` (new, in `Konten.jsx`) accepts the stored `"YYYY-MM-DD"` unchanged, or European shorthand: `D.M`/`D/M` (day always first, never the American order) with the year taken from the app's own year selector, or `D.M.YYYY`/`D/M/YYYY` with an explicit year. `DateEditor.jsx` is deleted entirely — Datum goes through the same plain field + `valueSetter` pipeline Empfänger/Details already use successfully.

**3. The native `<select>` inside Konto/Kategorie's popups wasn't opening at all on tap on Markus's device.** Real bug, not a misunderstanding — Markus's own diagnosis ("you seem to be using system dropdown, you will have to design it yourself") was right. Most likely cause: a stacking/rendering conflict between a native form control's own popup and AG Grid's own popup positioning (which applies a CSS transform to place itself) — a known category of issue on some platforms, not chased down to the exact mechanism since the fix doesn't need to know. New `src/Listbox.jsx` — a fully custom-rendered dropdown (a styled `<button>` + absolutely-positioned `<ul>`, no native `<select>` anywhere) used by both `KontoEditor.jsx` and `CategoryEditor.jsx`. This also *strengthens* Session 17's keyboard chain rather than just working around the bug: focusing a Listbox now opens it immediately (full control, no cross-browser uncertainty at all, unlike the native-select approach that could only ever focus-without-opening) — matching Markus's originally-described flow even more literally than before.

**Caught and fixed while wiring Listbox's Enter-to-apply:** the last Listbox in each chain calling `apply()` on Enter would have read stale React state — `onChange` (called synchronously just before) hadn't re-rendered yet at that point. Both editors' `apply()` now take an optional override argument, which the Listbox's `onEnter` supplies with the value it just committed; the Übernehmen button still calls `apply()` with no argument, where plain state is already current by the time of a real separate click.

**Next session should probably:** get Markus's read on all three in practice — the Listbox rebuild especially, since native-select rendering issues can be platform/version-specific and this was reasoned through carefully but not yet confirmed fixed on his actual device.

## Session 19 — 2026-09-23 — Build 44 "nothing works as described": three real regressions from Session 17/18, root-caused and fixed

Markus reported build 44 as broadly broken. First ruled out the deploy pipeline itself: build 44's GitHub Actions run (checkout → npm ci → test → build → publish) completed cleanly, and the build badge correctly showing "44" proves the browser is running the current bundle, not a stale cached one (the build number is baked in at build time under a content-hashed filename — there's no way to see "44" and be running old code). So this was a real code bug, not a deploy/caching problem. Asked Markus for specifics rather than guessing blind, and got three concrete reports plus a screenshot. All three turned out to be genuine regressions from Session 17/18, confirmed by reading AG Grid's own source rather than assumption:

**1. Datum still opens a modal, isn't plain text.** Root cause: AG Grid auto-detects a column's `cellDataType` from its actual row data when nothing overrides it, and neither `field`/`headerName`/`width`/`editable`/`valueSetter`/`colId` (everything the Datum column def had) is on the list of properties that suppress this inference. A plain ISO string like `"2026-01-01"` matches AG Grid's own built-in `dateString` type pattern, which auto-installs AG Grid's own `agDateStringCellEditor` — a calendar popup — silently overriding the plain-text editing intended here, despite no `cellEditor` ever being set explicitly. Confirmed directly in `ag-grid-community`'s `DataTypeService` source (`dataTypeMatchers.dateString`, `canInferCellDataType`). Fix: `cellDataType: false` on the Datum column def, which was the one thing actually missing.

**2. Konto/Kategorie keyboard chain still mouse-only.** Both editors focused their first Listbox via AG Grid's `afterGuiAttached` lifecycle hook. For a popup editor specifically, that hook is bridged through a promise that resolves once the React component's ref registers with AG Grid's wrapper — timing that isn't guaranteed relative to when the portalled popup content actually commits to the DOM, which is what focus() actually needs to succeed. Fix: moved the initial focus into a plain `useEffect(() => { ref.current?.focus() }, [])` inside `KontoEditor.jsx`/`CategoryEditor.jsx` themselves — React guarantees this only runs after the component's own DOM exists, so it doesn't depend on AG Grid's bridge timing at all. `afterGuiAttached` removed from both (redundant now).

**3. Stale blue row-tint after Ctrl+K → Escape/Enter back to the grid** (Markus's screenshot showed two rows tinted at once). `focusGridMidViewport()` only called `setFocusedCell`, relying on the grid's `onCellFocused` handler to select the landing row as a side effect — right after Escape/Enter change `accountFilter` (which changes the row set), that side effect wasn't reliably keeping up. Fix: `focusGridMidViewport()` now explicitly selects the landing row itself (`getDisplayedRowAtIndex(rowIndex)?.setSelected(true, true)`) instead of leaving it to `onCellFocused`.

All three verified against the actual AG Grid library source in `node_modules` (not guessed) before fixing, given a prior session's Übernehmen fix was misdiagnosed once already on an assumption that turned out wrong. `npm run build`, `npm test`, `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation all three are actually fixed on his device — none of this could be tested live against real data locally, only reasoned through source and verified to build/lint/test clean.

## Session 20 — 2026-09-23 — Two more from real usage of build 45: cursor not following a re-sort, Enter closing the popup

Markus tried build 45 and reported two further issues, both now fixed:

**1. Editing Datum re-sorts the row; the blue tint follows, the focus rectangle doesn't.** The grid stays actively sorted by date (the Datum column's `initialState` sort seeds the *live* sort model, not a one-off) — so changing a date via `parseFlexibleDate` moves that row immediately. AG Grid tracks row *selection* by node identity (via `getRowId`), so the blue tint correctly follows the row wherever it lands — but the *focused cell* is tracked as a plain `{rowIndex, column}` pair that doesn't automatically move when the row underneath it does. Fix: `handleCellValueChanged` now looks up the edited row's node by id after persisting and calls `setFocusedCell` on its current `rowIndex`, for whichever column was actually edited — not Datum-specific, since any column could in principle move a row if a different sort were ever active.

**2. Enter inside a Konto/Kategorie popup's Listbox applied nothing and just closed the whole popup**, instead of committing the highlighted option and advancing to the dependent list. Root cause, confirmed by reading AG Grid's own `cellKeyboardListenerFeature`/`onEnterKeyDown` source: AG Grid attaches its own native Enter/Escape/Tab handling at the popup-editor-wrapper level — the same mechanism that makes its *own* built-in popup editors (like the date picker Session 19 had to disable) work correctly. `Listbox.jsx`'s key handling was only calling `preventDefault()`, never `stopPropagation()` — and since our button, though rendered via a React portal, is still a genuine DOM descendant of that AG-Grid-managed wrapper, the raw keydown kept bubbling up to AG Grid's own listener regardless, which then stopped editing (discarding the popup, and with it whatever the Listbox had just committed only in local React state) before our own `onEnter` chain-forward ever had a chance to matter. Fixed by adding `stopPropagation()` alongside `preventDefault()` on every key Listbox handles.

**Also fixed in the same pass, reported alongside the Enter bug:** the highlighted option not scrolling into view once arrow-keying past the list's own `max-h-48` — added a `scrollIntoView({ block: 'nearest' })` effect keyed on the highlight index.

Both of Session 19's underlying diagnoses (the popup-editor timing fix, the `cellDataType: false` fix) held up fine in practice — these are two additional, previously-undiscovered bugs in the same area, not regressions from Session 19's own changes.

**Next session should probably:** get Markus's confirmation on these two, and, if the keyboard chain still isn't fully smooth, consider whether there's a *third* AG-Grid-vs-portal propagation conflict lurking (Escape, Tab) that just hasn't been exercised yet — the same `stopPropagation()` gap could in principle affect any key AG Grid also listens for globally, not only Enter.

## Session 21 — 2026-09-23 — Session 20's Enter fix didn't actually work; found the real mechanism this time

Markus tried build 46 and both Session 20 fixes were incomplete or wrong:

**1. Cursor still not following a re-sorted row** (screenshot: two same-dated rows, blue tint on one, cursor rectangle on the other). Root cause was one layer deeper than Session 20's fix reached: there are *two* re-sorts per edit, not one. AG Grid does its own immediate in-place resort the instant the valueSetter mutates the row (a *stable* sort, ties broken by original array position). Separately, once the Firestore round-trip lands the edit back through `onSnapshot`, `rows` recomputes from scratch with its *own* explicit date-then-id tie-break. For two rows sharing an exact date, these two sorts aren't guaranteed to agree on order — Session 20's fix refocused right after the *first* (transient) resort, which the *second* (authoritative) one then silently invalidated. Fix: `handleCellValueChanged` no longer refocuses directly; it now feeds the edited row into the same `pendingFocusIdRef`/`useEffect(..., [rows])` mechanism `addRow()` already used (generalized with a new `pendingFocusColRef` so it lands on whichever column was actually edited, not always Datum) — which only acts once `rows` itself has genuinely settled, the one point both resorts are guaranteed to agree on.

**2. Enter still closed the popup with no change applied.** Session 19's `stopPropagation()` fix was based on an incomplete model of *why* — confirmed this time by reading AG Grid's actual `PopupEditorWrapper` class (`packages/ag-grid-community/src/edit/cellEditors/popupEditorWrapper.ts`): it attaches a **native** `addEventListener('keydown', ...)` directly on the popup wrapper `<div>` our content gets portalled into — a genuine DOM ancestor of our button. React 17+ attaches only *one* listener of its own, at the app's root container, and simulates the rest of the bubble internally from there. That means the raw keydown reaches AG Grid's native, *closer* ancestor listener and gets acted on (stopping the edit) *before* React's own synthetic dispatch ever reaches our component's handler — so `stopPropagation()` called from *inside* a React `onKeyDown` prop is structurally too late no matter what, since our handler hadn't even run yet. (This also explains why arrow keys already worked: AG Grid explicitly no-ops its own navigation-key handling while a cell is being edited, so nothing ever raced ahead of them — only Enter/Escape, which AG Grid deliberately still acts on mid-edit to commit/cancel.) Fix: `Listbox.jsx` now attaches a genuine native listener directly on its own button via `useEffect` + `addEventListener`, not React's `onKeyDown` prop — this runs at the true target phase, before AG Grid's ancestor listener ever sees the event.

**3. New report, real bug: pressing Enter on Kategorie (even unchanged) wiped an already-selected Unterkategorie.** `CategoryEditor.jsx`'s Kategorie `onChange` cleared `categoryId` unconditionally on every commit, including Listbox's Enter-to-confirm firing for a group that was already correct (the normal case when arrowing through an already-categorized transaction). Fix: only clear when the group id actually changes. Now re-confirming an unchanged group leaves the existing subcategory in place, and the Unterkategorie list opens pre-highlighted on it — matching what Markus described the chain should do.

All three verified by reading the actual library source paths involved (not assumption) before writing the fix, same discipline as Session 19 — Session 20's Enter "fix" is the cautionary example for why that discipline matters even when a diagnosis *sounds* plausible.

**Next session should probably:** get Markus's confirmation. If Enter still misbehaves after this, the native-listener approach in `Listbox.jsx` is the right shape but worth re-checking for a missed key (Tab isn't handled at all yet, for instance) rather than assuming the whole approach is wrong again.

## Session 22 — 2026-09-23 — Build 47 "works almost perfectly"; one refinement to the category popup

Markus confirmed Session 21's three fixes all held. One remaining refinement: `CategoryEditor.jsx` is shared by both the Kategorie and Unterkategorie columns, and always started the keyboard chain at Kategorie regardless of which cell was actually opened — Markus wanted opening it *from* Unterkategorie directly to leave Kategorie exactly as it already was (it already did) and jump straight to the Unterkategorie list, open and pre-highlighted on the existing selection.

Added a `startField` param (`cellEditorParams`, set per-column in `Konten.jsx`: `'group'` for Kategorie, `'category'` for Unterkategorie), which the editor's mount-focus effect now reads to decide whether to focus Kategorie or Unterkategorie first. No change to the underlying data or the rest of the chain — Kategorie was never being reset by this, only which list receives initial focus.

**Next session should probably:** get Markus's confirmation on this one; if the keyboard chain overall is now solid, the standing "review the complete keyboard navigation once the app is fully built" item from Session 13 is worth reconsidering as done for this screen specifically, though not for the app as a whole yet.

## Session 23 — 2026-09-23 — PLAN.md Phase 1b: split transactions built, as specced

Markus: "ok lets go for split bookings as specced." Read spec.md §2.6/§3a's auto-remainder mechanism in full before writing anything, then built it.

**The interaction model, worked out from the spec's own framing ("a cached total... every aggregation runs off lines[]" once split, vs. the parent being authoritative while unsplit):** a transaction's `amountCents` stays a fixed total once it has more than one line — splitting only ever redistributes it, never changes it. Every line except the last is directly editable; the last is always the live remainder, recomputed on every save (`withRemainder()`, new `src/lib/split.js`, tested in `split.test.js` per PLAN.md Phase 1b's own called-out test-suite item). Starting a split and "splitting further" turned out to be the exact same operation once framed this way — append a blank line, and whatever was previously last becomes directly editable while the new one becomes the fresh remainder — no special-casing needed for "first split" vs. "split again."

**Display, Community-tier AG Grid has no master/detail:** `displayRows` (`Konten.jsx`) flat-maps `rows` into parent rows plus, for each expanded split transaction, its `lines[]` interleaved right after as synthetic rows (`{ __isLine: true, __parent, __lineIndex }`). Every column def branches on `__isLine` to render/edit differently — a line shows its own `note` (Empfänger, "↳ " prefix on display only), its own signed amount (except the last, non-editable), category (via the same `CategoryEditor` popup, now parameterized per-row through a `cellEditorParams` function and a new `initialCategoryId` prop replacing its old `data.lines[0]` assumption), and tags. A new pinned-left "split" column is the one control surface: ✚ starts a split and auto-expands; a chevron toggles expansion once split; ✕ removes a line; the last line also gets its own ✚ to split further.

**Caught during self-review before shipping, not by Markus this time:** Kategorie/Unterkategorie's `valueSetter` fallback (the AG Grid commit-pipeline path Tab can still reach, even though Übernehmen/Enter bypass it) still unconditionally called `ensureLine(p.data)` after the rest of those column defs were updated for line rows — for a line row, `p.data` is the synthetic object with no `.lines` of its own, so this would have silently created a bogus array on the throwaway object and lost the edit. Fixed to branch the same way the rest of the column already does.

**Disclosed, not silently shipped: the split column's buttons are mouse/tap-only for now.** AG Grid's cell focus (arrow-key reachable) isn't the same as real DOM focus on the button inside that cell, so Enter doesn't trigger them yet — a real gap next to how much keyboard-navigation work the last several sessions put into everything else in Konten. Worth a dedicated pass once real usage shows it's actually needed.

`npm run build`, `npm test` (14 passing, 5 new), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's read on the interaction model itself against a real split (e.g. the Airbus salary deposit) — this was built carefully from the spec but not yet exercised against real data, and the mouse-only control buttons are the most likely first friction point to report back.

## Session 24 — 2026-09-23 — First real-usage round on split transactions: three fixed, one open question

Markus tried splitting a real Bar Julia transaction and reported four issues, from two screenshots. Three fixed:

**1. Line rows appeared above the parent instead of below it.** Root cause: the Datum sort is always active, and a line row's Datum cell is deliberately blank — AG Grid's *default* comparator sorts an empty string before any real date, so every expanded transaction's lines floated to the very top of the whole grid, not just above their own parent. Fixed with a custom `comparator` on the Datum column that compares by the *parent's* date for both a parent row and its own lines (tying them), relying on JS's stable sort to then preserve `displayRows`' own build order for the tie. Disclosed limitation, not chased further: only Datum got this fix, so sorting by a different column could still scatter an expanded transaction's lines away from its parent.

**2. Split lines now get a distinct tint** (`--color-line-row-tint`, new token in `index.css`) via `getRowStyle`, so they read as visually separate from ordinary rows at a glance.

**3. Stale tint after adding/removing a split line.** The split column's ✚/✕ buttons are plain clicks, not cell edits — they never went through `handleCellValueChanged`, so nothing told the grid which row to re-select once each action's Firestore round-trip landed, leaving AG Grid's own selection state to drift onto whatever row happened to land at the same position afterward. Fixed by routing these buttons through the same `pendingFocusIdRef`/`rows`-settle mechanism cell edits already use.

**4. Open question, not guessed at a third time this session:** Markus's report — "when i delete one out of two splitlines... both remaining lines need to be deleted when i delete the one before the last split line" — describes a cascade-delete expectation for removing a *non-last* line in a 3+-line split that doesn't match what's built (removing any one line just lets the remainder re-absorb it, per spec's own "creating a first sub-line... leaves a second... line" framing, which is what §3a actually describes). Given two fixes already went out wrong earlier this session on non-obvious AG Grid behavior, and given the display bug above (#1) likely made the actual state hard to read correctly by eye, this needs a direct answer from Markus rather than a third guess — asked directly rather than shipped speculatively.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Resolved directly with Markus, same session:** asked plainly whether deleting a non-last line should cascade-remove everything after it, or just re-absorb that one line into the remainder. Confirmed the built behavior (just that one line) is what he actually wants — the confusing report was very likely just the display-ordering bug (#1) making it hard to read the real state by eye, not a genuine mismatch in delete semantics. No further code change needed here.

**Next session should probably:** get Markus to re-verify all three fixes against real data again, now that the display itself should read correctly.

## Session 25 — 2026-09-23 — AG Grid was never actually following dark mode

Markus: the grid was illegible in dark mode (screenshot: white grid, dark app shell around it, Session 24's new line-row tint barely readable smashed against that mismatch).

Root cause: `themeQuartz` ships light/dark color params out of the box (its `colorSchemeVariable` theme part), but they only activate behind a `data-ag-theme-mode="dark"` attribute on `<html>`/`<body>` — nothing in this app was ever setting it, so the grid was stuck in its light default the whole time, completely independent of `index.css`'s own `prefers-color-scheme` media query that correctly drives the rest of the app. New `src/lib/gridColorScheme.js` (`syncAgGridColorScheme()`, called once at module load in `Konten.jsx`) mirrors the same system preference onto that attribute, kept in sync if it changes while the app is open. Written to be reusable as-is once Verlauf (spec.md §1b.3) shares the same grid engine later.

**Verified visually, not just reasoned from source, given how many AG Grid quirks have needed correcting this session already:** built a standalone Playwright harness (scratchpad, not part of the repo) importing the real `ag-grid-community` package directly, rendered a small sample grid with both a dark-mode emulated page and a light one, and screenshotted both. Confirmed: the grid genuinely re-themes, and `--color-line-row-tint` (Session 24) reads clearly and legibly in both modes — not just plausible from reading the theming source.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation this actually reads well on his real device — the standalone harness confirms the mechanism works, but AG Grid's own dark palette is its own generated colors, not tied to this app's specific CSS tokens, so it's worth a real look rather than assuming the harness's approximation is the final word on how it feels next to the rest of the app.

## Session 26 — 2026-09-23 — Two more split-transaction reports: a real row-identity bug, and a focus request

**1. A stale leftover line row after deleting a non-last split line** — real bug, root-caused properly this time rather than guessed at. A line has no stable id of its own in the schema (§2.6); `displayRows`'s synthetic line-row ids were built from array index alone (`${tx.id}::line::${i}`). Removing a non-last line shifts every later line's index, so a *surviving* line ends up with the *removed* line's old id — AG Grid's id-based row reconciliation can't tell "this row moved to a new index" from "this id now holds different content," and was left with an inconsistent, stale extra row. Fixed by baking the parent's current line *count* into every line row's id too (`${tx.id}::line::${i}::${tx.lines.length}`) — any add/remove changes the count, forcing AG Grid to fully rebuild that transaction's line rows instead of attempting an ambiguous partial match, while a pure value edit (which doesn't change the count) still keeps ids — and smooth updates — stable.

**2. Editing a split line's own field jumped the cursor back to the parent row instead of staying put.** This was a disclosed simplification from Session 23, not a bug fix skipped — the code comment at the time said as much. Fixed now that Markus asked for it directly: `handleCellValueChanged` carries the edited line's own index through a new `pendingFocusLineIndexRef`, and the existing settle-then-focus effect looks that specific line back up by `__parent` + `__lineIndex` (not by reconstructing its now count-dependent synthetic id) once the Firestore round-trip lands, falling back to the parent's row if that exact line no longer exists by then.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus to re-verify both against real data — the row-identity fix in particular is exactly the kind of thing that's easy to reason through on paper but only really confirmed by a live multi-line split, add, and delete sequence on his actual device.

## Session 27 — 2026-09-23 — Sort-glue generalized to every column; Markus switching Claude Code subscriptions

Markus caught that Session 24's Datum-only sort fix (line rows glued to their parent) only actually covered Datum — sorting by any *other* column still scattered an expanded transaction's lines back to the top of the whole grid, since every other column still used AG Grid's default value-based comparator. Generalized: new `glueToParent(getValue)` module-level helper (given a function computing a column's "parent-level" value, compares every row by its own parent's value, relying on the same stable-sort-preserves-build-order tie-break Datum's fix already established) is now wired into every sortable column, not just Datum. Extracted each column's "parent-level" value into a small named function (`kontoValue`, `betragValue`, `kategorieValue`, `unterkategorieValue`, `tagsValue`) shared between its `valueGetter` and its new `comparator`, rather than writing the derivation twice and risking drift. Betrag glues a line to its parent's *total* for sorting, not the line's own distinct amount — sorting the whole grid by every individual line's own amount isn't meaningful either way, so gluing it to its already-correctly-sorted parent is the sensible behavior there too, same as everywhere else.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Markus is likely continuing this project under a different Claude Code subscription from here** and asked that the standing documents be brought fully current for a cold-start handoff, plus whether there's anything to watch out for. Per CLAUDE.md's own design, this is exactly what spec.md/PLAN.md/DEVLOG.md/CODEMAP.md are for — nothing about this session's own back-and-forth is needed beyond what's already landed in these four files. Did a full pass confirming all four are current (see below); flagged the couple of things worth Markus's own attention in the chat reply, not buried here.

**Next session should probably:** start exactly per CLAUDE.md's own "Starting a new session" checklist — skim spec.md's TOC, read PLAN.md's current phase (1b, split transactions — functionally complete, real-usage fixes ongoing), read this file's most recent 2-3 entries, skim CODEMAP.md. Get Markus's confirmation on the sort-glue generalization and the row-identity fix from Session 26 against real data; both were reasoned through carefully but are the kind of thing only truly confirmed by live use.

## Session 28 — 2026-09-23 — Open design question logged: split lines need their own account routing

Markus flagged this directly, asked it be noted rather than acted on immediately ("we need to think this through for any downstream impacts") — logged here and in PLAN.md's Phase 1b, not implemented.

**The problem:** a split line is an individual booking in its own right and must be able to route to a "virtual" account (ESOP, Aktien — the `investment-tracking` group, §2.2) directly, not just carry a category. Today's schema (§2.6) gives `lines[]` no account fields at all — `fromAccountId`/`toAccountId` are fixed once, at the parent transaction level, for the *whole* booking; only the economic categorization (`categoryId`) actually splits per line. Concrete case this can't represent correctly: part of a gross paycheck routes straight into ESOP before it ever touches the bank account — that portion never "arrives in BNP and then gets tagged ESOP," it's money that goes directly to a different account. Tagging that line's category as "ESOP" today is semantically wrong (a category isn't an account) and does nothing to ESOP's own computed balance — `balance()` never looks inside `lines[]` at all currently, only at the transaction-level `fromAccountId`/`toAccountId`.

**Downstream impacts spotted so far, not evaluated for what to actually do about them — a starting point for the real design pass, not a design itself:**
- **`balance()`** (`src/lib/balance.js`) sums per *transaction*, keyed on the transaction's own `fromAccountId`/`toAccountId`. If a line can carry its own account, this would need to sum per *line* instead (or per line where an override exists, falling back to the parent otherwise) — a real rearchitecture of the one already-tested, foundational calculation the whole app's balances rest on.
- **The split invariant** (§2.6: parent `amountCents` === Σ `lines[].amountCents`, `src/lib/split.js`'s `withRemainder()`) is about the *amount* only and probably still holds regardless of which account each line routes to — but needs re-confirming once lines can have genuinely different real-world destinations, not just different categories of the same movement.
- **Konto's column display** (`Konten.jsx`) shows one arrow for the whole transaction; an expanded line with its own account would need its own Konto display too, which the current column defs don't have any concept of (Konto is blank/fixed for every line row right now — a real, not cosmetic, change).
- **Transfer-leg matching** (§3a's suggest-and-confirm mechanism, not yet built) currently operates on whole transactions — would need to consider whether a *line's* own account-if-any participates in matching too.
- **The migration scripts** (`migration/transform-transactions.py`) always assume transaction-level Konto routing; historical data doesn't have this concept at all, so nothing there breaks, but any future re-import logic would need to know this is a schema extension, not the original shape.

**Next session should probably:** not guess at a schema extension here — this needs a real conversation with Markus about the actual shape (a per-line account override field? something else?) before any code changes, given how central `balance()` is to everything else already built and tested.

## Session 29 — 2026-09-24 — Split-line delete moved to the trashcan, Ctrl+Enter added

Three requests, all about the split-line UX getting closer to how the rest of Konten already behaves.

**1. A split line's own delete now goes through the trashcan column, not the split column's old instant-remove ✕.** Markus wanted it to behave exactly like deleting a whole transaction — arm, red tint, confirm — not a one-click removal sitting right next to a two-click one. `handleDeleteClick` now takes the row itself (not just an id) and branches: `removeLine` on the parent for a line row, `deleteDoc` for a transaction row; `confirmDeleteId`/`getRowStyle`'s red tint didn't need any change at all, since they already just compare against whatever id is currently armed, parent or line. The split column's own ✕ is gone — one consistent delete affordance now, not two with different confirmation behavior. The keyboard Delete key picked this up for free (same `handleDeleteClick` call), closing part of Session 23's disclosed "mouse/tap only" gap — the guard that used to skip line rows entirely is gone too.

**2. Ctrl/Cmd+Enter now triggers the same add/split-further action as the ✚ button**, for whichever transaction the cursor currently sits on — reads the grid's focused cell, resolves it to a transaction (its own row, or its line's `__parent`), and calls the same `addSplitLine`. Closes the other half of that gap; only the expand/collapse chevron itself stays mouse-only now (noted in CODEMAP, not chased further without a real reason to).

**3. Both the button and the shortcut now land the cursor on line index 0's own Betrag field afterward** — the natural next step either way is typing how much that first piece actually is. Taken literally from Markus's wording ("the first breakdown line," not "whichever line just became editable") — worth watching whether that's still the wanted behavior once he's used "split further" a few times on a line deep into an already-multi-line split, since that case lands back on line 0 rather than the line that just unlocked. Betrag got an explicit `colId` so this could target it reliably (previously auto-generated, never referenced anywhere by name).

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation on all three against real data, and specifically watch for feedback on point 3's "always line 0" choice during a deeper split-further sequence — the one part of this session's reasoning that was a judgment call on ambiguous wording rather than a literal instruction.

## Session 30 — 2026-09-24 — Ctrl+Enter didn't actually work: AG Grid's own Enter handling won the race

Markus: "ctrl+enter does not work, just behaves like enter." Root-caused before patching, not guessed — checked the exact same class of bug Session 21 already found once this session (worth remembering going forward: any single-key binding on Enter/Escape/Tab/Delete/F2/arrows needs this check by default, not just when something breaks).

Confirmed directly in `ag-stack`'s bundled source: `RowContainerEventsFeature` attaches a genuine *native* `keydown` listener straight on the row container element — a real DOM ancestor of every grid cell — via a plain bubble-phase `addEventListener` (no capture option passed anywhere in the chain down to `_addSafePassiveEventListener`). That listener reacts to plain `Enter` regardless of any Ctrl modifier and starts editing the focused cell. Session 29's Ctrl+Enter handler was a normal bubble-phase `window` listener — strictly further out in the same bubble chain than the row container, so it always lost the race: AG Grid's own handler ran first, started editing, and by the time this handler ran its own "don't fire while a cell is already mid-edit" guard correctly, but unhelpfully, treated that as "already editing" and no-opped. Exactly the same shape of bug as `Listbox.jsx`'s Enter-key fix (Session 21), just a different pair of competing listeners.

Fix: register the Ctrl+Enter listener on `window` with the capture-phase flag (`addEventListener('keydown', onKeyDown, true)`) and call `stopPropagation()` once it's decided to act. Capture phase runs top-down before the event ever reaches its target, which is strictly before *any* bubble-phase listener anywhere in the tree — stopping propagation there means AG Grid's own row-container listener never sees this specific keypress at all. The other two global shortcuts (Ctrl+`'+'`, Ctrl+K) didn't need this, since `+`/`=` and `k` aren't keys AG Grid's own core handling intercepts.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation Ctrl+Enter actually works now. Also worth keeping in mind for any *future* single-key global shortcut in Konten: check whether AG Grid's own `_onCellKeyDown` switch (Enter/F2/Escape/Tab/Backspace/Delete/arrows) already claims that key before assuming a plain bubble-phase `window` listener will work — it only reliably does for keys AG Grid doesn't already own.

## Session 31 — 2026-09-24 — Ctrl+Enter still didn't fire even fixed; reassigned to Ctrl+T

Markus, after Session 30's capture-phase fix shipped: "ctrl enter does not work, gues this is blocked. assign splitting to ctrl+t instead (for teilen)."

The capture-phase/`stopPropagation()` fix from Session 30 was real and correct for the race it targeted — AG Grid's own row-container listener genuinely no longer sees the keypress first. But it only wins races *within* the page's own JS event handling; it can't reach a layer further out than that. Enter is one of the most universally browser/OS-reserved key combinations there is on some platforms — iPadOS's own external-keyboard handling among them, and Markus's screenshots this session have consistently shown an iPad — meaning the browser/OS can swallow the keypress before it's ever dispatched to the page's JavaScript at all. No in-page fix, capture phase included, can reach that. Not independently confirmed (no way to from here), but it's the only explanation left standing once the actual in-page race was already fixed and still didn't work.

**Fix, per Markus's explicit instruction: reassigned the shortcut from Ctrl+Enter to Ctrl+T** ("Teilen"). Same handler, same capture-phase/`stopPropagation()` technique kept (still correct and still needed for the in-page AG Grid race regardless of which key, harmless to keep even though T isn't a key AG Grid's own core claims at all). Both button `title`s ("Weiter aufteilen"/"Aufteilen") updated to say "(Ctrl+T)".

**Flagged to Markus, not yet answered:** Ctrl+T carries a real risk of failing the exact same way — it's arguably an even more universally browser/OS-reserved combo than Enter ("open new tab," virtually everywhere). If it silently fails too, that's the same underlying obstacle, not a code problem, and no further code-level diagnosis is likely to help — the only way to actually know is Markus trying it on his real device and reporting back.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation on whether Ctrl+T actually works. If it also silently fails, the likely real fix is abandoning a Ctrl-combo entirely in favor of a key with no browser/OS reservation at all (a bare letter while a cell is focused but not editing, for instance) rather than continuing to gamble on modifier combos one at a time.

## Session 32 — 2026-09-24 — Ctrl+T confirmed working; a second focus/selection race fixed

**Ctrl+T works** — confirmed by Markus on his real device, closing out Session 31's open question. The browser/OS evidently doesn't reserve it the way Enter apparently is.

**Bug, caught by Markus mid-way through an unrelated Firestore PITR walkthrough (screenshot):** after Ctrl+K into the pinned panel, arrowing to a different account (live-filtering as it moves), then Enter to return to the grid, the cell-focus rectangle landed on one row while the blue selection tint stayed on a completely different one — the exact "split tint" symptom a comment already on `focusGridMidViewport` (Session-unlabeled, predates this numbering) had previously fixed once for a *different* pair of racing callbacks (AG Grid's own transient resort vs. `rows`' own settled order, per the comment right above `pendingFocusIdRef`'s declaration).

**Root cause, read from the actual code rather than guessed:** two genuinely independent mechanisms can each claim "move the cursor and the blue tint to row X" — the edit-settle effect (`pendingFocusIdRef`, watches `rows` for an edited/added row to settle in after its Firestore round-trip) and `focusGridMidViewport` (the panel's Escape/Enter handling, its own immediate `setTimeout(0)`, unrelated to any Firestore round-trip). Both existed as fully separate deferred callbacks, each internally calling both `api.setFocusedCell(...)` and `node.setSelected(true, true)`. An edit made just before a quick Ctrl+K/arrow/Enter sequence can still have its own settle effect pending when `focusGridMidViewport`'s timeout fires — and since neither callback's pair of calls is atomic against the other's, the *interleaving* of the two (not just "last one wins" as a whole) can leave one callback's `setFocusedCell` as the final word while the *other* callback's `setSelected` is — splitting the two across different rows.

**Fix:** a shared monotonic counter (`focusClaimRef`), bumped by every claimant. Every place that used to set `pendingFocusIdRef`/`pendingFocusColRef`/`pendingFocusLineIndexRef` directly (five call sites: cell-value-changed, `addRow`, the Ctrl+T handler, and both split-column ✚ buttons) now goes through one helper, `claimPendingFocus(id, colId, lineIndex)`, which sets all three refs and stamps the claim's own counter value alongside. `focusGridMidViewport` makes its own claim on the same counter (and clears `pendingFocusIdRef` outright, so a same-id edit-settle that hasn't even fired yet can't spuriously re-fire later off some unrelated future `rows` change). Each deferred callback checks, right before it applies anything, that its own stamped claim number still matches the live counter — a superseded claim silently no-ops instead of partially overwriting a newer one. This makes "whichever action the user most recently initiated wins, in full" true by construction, rather than depending on which of two independent timeouts happens to fire last.

`npm run build`, `npm test` (still 14 passing), `npm run lint` all clean before pushing.

**Next session should probably:** get Markus's confirmation the stale-tint bug is actually gone now, specifically re-testing the same Ctrl+K → arrow → Enter sequence right after an edit. Also worth a general note for any *future* code that wants to move the grid's focus/selection programmatically: route it through `claimPendingFocus` (if it can wait for `rows` to settle) or through `focusGridMidViewport`'s claim pattern (if it needs to act immediately) rather than adding a third independent `setTimeout` — that's exactly how this class of bug keeps recurring.
