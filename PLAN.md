# Development Plan

The intended build order, staged by data dependency — what has to exist before the next thing can be meaningfully tested against it. Revised when the plan itself changes (a phase gets reordered, split, or rescoped), not appended to every session — that's what `DEVLOG.md` is for. Each phase ends with a **testable deliverable**: something Markus can concretely verify himself, not just "code exists."

See `CLAUDE.md` for how this fits alongside `spec.md` and `DEVLOG.md`.

---

## Phase 0 — Infrastructure, scaffolding & offline architecture

- Firebase project created (Auth, Firestore) — done together with Markus, step by step, per `CLAUDE.md`'s infrastructure-setup guidance.
- React + Vite + Tailwind scaffolded (§1b.1); `vite-plugin-pwa` configured.
- Single-admin-UID security rule in place (§1a).
- **Point-in-Time Recovery (PITR) enabled at database creation** (§2.9a) — must be done via the `gcloud` CLI at creation time, not the Cloud console; the whole-database, 7-day generic safety net that everything else in §2.9a builds on top of.
- **Offline architecture set up here, not retrofitted later** (external review, Sept 2026 — §1a already treats this as architectural, not a bolt-on): Firestore persistent cache configuration, the Auth-init timeout handling, and the service-worker strategy — roughly a day of work that shapes how every later screen loads data. Getting this wrong and discovering it in Phase 7, after six phases were built against an implicitly-online assumption, is exactly how §1.1's original bug (aggregation queries silently failing offline) would get rediscovered at the worst possible time.
- Deployed to GitHub Pages (§1b.1 — Firebase Auth's authorized-domains list updated to trust the Pages URL).

**Testable deliverable:** Markus can open the deployed URL on both phone and tablet, sign in with Google, install it as a PWA, and see a blank authenticated shell. Then, with WiFi off, reload the app and confirm it still opens (empty, but alive) rather than showing a white screen or an auth error — the offline foundation working before any real screen is built on top of it. Separately, PITR's status is confirmed enabled directly in the Firebase console's Disaster Recovery page — a real check, not just trusting the setup command ran correctly.

---

## Phase 1a — Konten core: grid & manual entry

- Firestore collections created per §2: `accounts`, `categories`, `tags`, `transactions`, `budgets`, `categoryYearSettings`, `settings` — seeded with real category/account/tag data (one-off migration from the Gsheet, not the full Settings UI yet).
- **Historical migration:** 2025's full transaction history *and* its Plan0 and Plan1 budget rows imported (§2.3/§4/§3c; Plan1 added Sept 2026 so 2025's Verlauf shows every line the Gsheet does) — 2025 gets the single `Jahresabschluß` opening-balance anchor transaction (the one and only one, ever, per account); 2026 gets none, since its Jahresanfang is a computed lookup against 2025's Dec 31 balance. Deliberate: a full closed year of real data is the actual validation target for the whole computation engine, not just a means to unblock a formula.
- Konten's grid (AG Grid), single-line manual transaction entry, Konto1/Konto2 and Kategorie/Unterkategorie cascading dropdowns, the pinned balance panel.
- Full keyboard cell-to-cell navigation working (§1 requirement).
- AG Grid's built-in cell-edit Undo/Redo enabled (§2.9a) — free, Community tier, `Ctrl+Z`/`Ctrl+Y`.
- **First test suite entry (§4.1, external review):** `balance()` — including the all-time, single-anchor model (§2.1/§2.3) — tested against 2025's real migrated figures.

**Testable deliverable:** with 2025 fully migrated, every account's computed balance matches its real closing balance from the Gsheet, for the entire year — the genuine test of §2.1/§2.3's balance model, not a hand-entered sample. Markus can also manually enter a week's worth of real 2026 transactions on tablet, with the pinned balance panel continuing seamlessly from 2025 with no double-counting at the year boundary, and full keyboard navigation working throughout.

---

## Phase 1b — Split transactions, tags & a first safety net

- Split-transaction UI and the auto-remainder mechanism (§3a) — separated from 1a deliberately (external review, Sept 2026): the most intricate interaction in the app, worth its own checkpoint rather than being bundled with "does the grid work."
- Tags (allocation, grouping, claim, breakdown) wired into Konten.
- **Test suite addition:** the split-transaction invariant (§2.6 — parent always equals Σ lines).
- Soft-delete with a recovery window (§2.9a) for transaction deletion in Konten — the one layer AG Grid's cell-edit undo doesn't cover.
- **Basic export — moved up from much later in the plan (external review, Sept 2026):** a rough, unpolished raw JSON dump of every collection, plus a rough script that reads it back into Firestore. Not §3k's full design (that stays in Phase 7) — just a real safety net that exists *before* Phase 2's CSV import and Phase 7's destructive Settings operations (merge, archive, restructure) start touching real data with no undo.

**Testable deliverable:** Markus splits a real transaction (e.g. the Airbus salary line) into multiple tagged lines, watches the live remainder recalculate correctly as lines are added, and confirms the parent/line totals reconcile exactly. Separately: runs the basic export, deletes a test transaction, runs the restore script, and confirms it's back.

---

## Phase 2 — Konten import & automation

- CSV import pipeline, auto-categorization by keyword (~70% target, `categorizationRules` collection, §2.7b), duplicate detection.
- Automatic transfer-leg matching (§3a) — the suggest-and-confirm mechanism.
- Konten's filter/search bar (quick-filter, per-field filters, date presets, saved filters).

**Testable deliverable:** Markus imports a real BNP CSV export, sees auto-categorization apply to roughly 70% of rows, manually categorizes the rest, and enters two transfer legs (one BNP, one Livret A, different days) that correctly get suggested as a match.

---

## Phase 3 — Verlauf & Planung

- `budgets` collection wired up; Verlauf's grid (category/subcategory × month, Prog/Plan1/Plan0 rows, breakdown-line mechanism, parent-tag automated rollup). AG Grid's Undo/Redo (§2.9a) enabled here too, same as Konten.
- Planung as the read-only mirror of Verlauf, with the automated regular/lump split (now reading `categoryYearSettings`, §2.7c).
- **Test suite addition:** the §3c `Budget` formula, against the real 2025/2026 figures already in spec.md — ready-made expected values, no fixture data needed.

**Testable deliverable:** with 2025's real Plan0 fully migrated, Verlauf and Planung reproduce 2025's actual numbers exactly as they read in the Gsheet. Markus then enters a Plan1 budget for one real 2026 category in Verlauf, sees Planung reflect the identical numbers as a report, and sees Prog auto-computed correctly once a few real Konten transactions land in that category.

---

## Phase 4 — Parallel-run validation month

**New phase, added on external review (Sept 2026) — the real acceptance test for whether the data model is actually right, at the last point where fixing it is still cheap.** With Konten and Verlauf both working, run the app and the real Gsheet side by side for one full month of real, live entry — every transaction entered in both, every number compared. This happens *before* Dashboard, Außenstände, Fortschritt, Monatsabschluss, and Settings all get built on top of assumptions that haven't actually been checked against reality yet.

**Testable deliverable:** at the end of one real month, every number the app produces — account balances, category totals, Verlauf's Prog column — matches the Gsheet exactly, or every discrepancy found has a known, understood reason (not a mystery). Any real problem found here gets fixed now, not after four more phases are built on top of it.

---

## Phase 5 — Außenstände, Fortschritt, Quickview

**Moved ahead of Dashboard (was after it) — external review, Sept 2026: Dashboard's alerts band (§1b.2) is specced to surface open Außenstände items, which didn't exist yet under the original ordering. Nothing in this phase depends on Dashboard, so moving it earlier costs nothing.**

- Tag-based claim/loan net-zero closure mechanism (§3g), including the close-out action for partial settlements.
- Fortschritt's Kategorie/Unterkategorie selector with auto-discovered tag cards (§3j).
- Quickview drill-down.

**Testable deliverable:** Markus tags a real informal loan's outflow and its later repayment with the same tag and watches the open-status dot clear itself automatically, with no manual linking step — then deliberately under-pays a test claim and confirms the close-out action correctly books the residual and clears it too. Fortschritt on `Urlaube` correctly splits a real trip into Bereits gebucht / Noch geplant.

---

## Phase 6 — Dashboard (Prognose + Status)

- The card grid: alerts band, Prognose hero chart, Jahresbilanz, Geldanlage-Standort, Status (condensed), Quickview doorway.
- The cross-cutting reconciliation checks (§2.8a).
- Card detail views — at minimum functional; their fuller filter/display controls (deliberately undesigned, §1b.2) can wait.

**Testable deliverable:** Dashboard loads with real data and correctly shaped charts; the alerts band correctly surfaces a real open Außenstände item from Phase 5 (not a placeholder), and Markus deliberately creates a Rücklagen mismatch (mistags one transaction) and confirms it shows up in the alerts band without a page refresh.

---

## Phase 7 — Monatsabschluss, full Settings, polished Export

- Monthly checklist (auto-derived items + manual to-dos).
- Full Settings CRUD — rename/archive for categories, accounts, tags (merge cut, §3i/§4); restructuring. Un-archive (§2.9a) and soft-delete-with-recovery for the rare true hard-delete case.
- **Export, polished (§3k)** — the full transactions CSV (parent/child row structure, no double-counting) and the complete-dataset JSON, now including `categorizationRules` and `savedFilters`. Paired with a documented restore procedure this time, not just the rough script from Phase 1b.

**Testable deliverable:** Markus archives a real test category, confirms it disappears from every picker while historical transactions referencing it still render correctly, then runs the polished export, opens the CSV and confirms the parent/child structure matches spec, and confirms the documented restore procedure works end to end.

---

## Phase 8 — Offline hardening & real-device validation

**Verifying, not introducing** (external review, Sept 2026) — the architecture work already happened in Phase 0; this phase confirms it holds up under real conditions, plus the items already flagged in `DEVLOG.md` as needing a real build to validate: Konten's phone split-transaction expand/collapse, Verlauf's breakdown mechanism against more real categories than just Schottland.

**Testable deliverable:** Markus puts his phone in airplane mode, enters and categorizes a transaction, then reconnects and confirms it synced correctly with no data loss or duplication.

---

## Deliberately not phased — ongoing/parked

- Amazon intra-order categorization — parked (§4), no clean source data, not part of any phase above.
- Gehaltsabrechnungen, Geldanlage — parked ideas (§4), may never get built.
- Exact filter/display controls inside each Dashboard card's detail view — undesigned, to be resolved whenever Phase 6 gets revisited in more depth.
