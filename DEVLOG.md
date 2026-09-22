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
