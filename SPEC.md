# Household Finance App — Spec

**If you are Claude Code:** `CLAUDE.md` is read automatically and points here first — you should be reading this file second, before touching any code, then `DEVLOG.md` third.

Status: **early draft, evolving.** This document is the running source of truth for *what the app is* — every resolved design decision lives here, updated only when a real decision is made or corrected, never as a progress log. (Build-time status, what's actually been coded, and open implementation questions live in `DEVLOG.md` instead — see `CLAUDE.md`.) Sections will be added/refined as we work through each app area.

**Working with Markus:** Markus is not a programmer — a solo "vibe coder" who builds by prompting AI and verifying results, not by writing or reading code himself. Never assume familiarity with programming concepts, terminology, or tools (including things that might seem basic, like what a rowspan is or what a package manager does). When something requires a technical decision, explain it in plain terms first, then ask rather than assuming — this applies throughout implementation, not just spec-writing.

---

## 1. Key Requirements

- **Platforms:** Must work well on both tablet and mobile (phone). Desktop/browser use is secondary but should not be broken.
- **PWA:** Fully installable as a Progressive Web App.
- **Offline-first:** Full offline capability, with sync to Firebase once connectivity returns. The app must be fully usable with no network connection (data entry, viewing balances, etc.).
- **Single user:** One admin user only. No multi-user sync/sharing model needed. However, sync **across the user's own devices** (phone, tablet, desktop — all connected to the same Firebase project) must be seamless and near-instant.
- **No overscroll / pull-to-refresh:** The UI should not exhibit rubber-band overscroll or accidental pull-to-reload behavior common in mobile web views.
- **Minimal-click workflows:** Every recurring workflow (especially transaction entry) should be optimized for the fewest possible taps/clicks. This is a daily-use tool, not an occasional one.
- **High performance + full keyboard control:** Especially in table/grid views with high interaction density (e.g. the transaction ledger), full keyboard navigation must work — arrow keys / Tab to move cell to cell, without needing to reach for the mouse/touch for each field. Must feel closer to a spreadsheet or data-grid tool than a typical mobile form-based app.
- **Maximize automation:** wherever manual clicks can be replaced by automation (auto-categorization, auto-import, auto-suggestion), they should be — this is the primary lever for reducing clicks, alongside UI/workflow optimization itself.

A detailed "lessons learnt" document from a previous related PWA+Firebase project has been reviewed and distilled into §1a below — treated as experienced guidance to weigh critically for this project's actual shape (single-user, multi-device), not as fixed rules to copy wholesale.

---

## 1a. Technical Architecture Guidance (from a prior PWA+Firebase project)

Source: a real, deployed PWA (Firestore + Firebase Auth + service worker) built and used daily on real Android hardware; every point below traces back to a bug that actually shipped. Adapted here for this app's actual shape — single admin user, multi-device sync — dropping what was specific to multi-user membership management, keeping what generalizes.

**Offline reliability (directly load-bearing for the offline-first requirement in §1):**
- `navigator.onLine` cannot be trusted on real mobile hardware — it can report `true` with both WLAN and airplane mode off. Any reachability decision (including Firebase's own SDK internals) needs its own bounded, abortable probe rather than trusting this flag.
- Firebase Auth's own init can silently make network calls before the first auth-state callback fires (loading a redirect-helper iframe, re-validating a restored session) — on a flaky or genuinely offline connection this can stall a cold start for 30–90+ seconds, and if local persistence is user-partitioned, **no cached data loads at all** until that callback resolves. Needs an explicit bounded timeout around Auth's own init calls, since single-admin-user doesn't remove this risk (it's an SDK-internal behavior, not a multi-user concern).
- Enable Firestore's persistent local cache properly (`persistentLocalCache`, unlimited size, multi-tab manager) and treat it as the real offline data store — not a bolt-on. This is the mechanism that makes "fully usable with no network connection" (§1) actually true rather than aspirational.
- While offline, a failed token refresh must not be treated as a sign-out — keep the last-known session trusted until an explicit sign-out or a real reconnect. Relevant even for a single user, since the whole point of offline-first is not getting logged out mid-flight on a plane or in a basement.

**Service worker, if one is used for install/offline shell:**
- Navigation should be network-first, not cache-first — a stale cached shell intercepting an auth redirect is a classic way to quietly break sign-in.
- Every fetch inside the service worker needs an explicit timeout (~2.5s) — an unbounded `fetch()` can hang far longer than any real connection would, on a device where the network stack itself is slow to fail.
- Separate the app-shell cache (wiped every deploy) from any third-party/CDN runtime cache (should persist across deploys) — tying both to one version string causes unnecessary slow reloads after every single deploy.
- Cache installation should tolerate one bad URL (`Promise.allSettled`, not `cache.addAll`) so a single typo doesn't leave the app with zero offline cache.

**Firestore security rules — single-user simplifications and gotchas that still apply:**
- Multi-user concerns from the source material (self-provisioning bootstrap, tombstoning removed members) don't apply here — with one fixed admin UID, the rule can be as simple as "only this UID may read/write anything," no membership-document dance needed.
- The gotcha that **does** still apply regardless of user count: accessing a map field that was never written on a document **throws** inside a Firestore rule (unlike JS's `undefined`), and a thrown error denies the whole rule, not just that comparison. Any rule added later that checks a field not present on earlier documents needs `.get(key, default)`, not direct dot-access, or old data silently breaks new rules.
- A rejected offline write is dropped silently on reconnect by default, with no error shown to the user — worth designing an explicit "sync failed" indicator somewhere in the UI (tied into the general reconciliation/flagging philosophy already established in §2.8a and the Konten yellow-highlight convention), rather than relying on Firestore's default silence.

**Sync model — directly relevant given the multi-device (not multi-user) requirement in §1:**
- A single large document rewritten wholesale on every small edit can't have real conflict resolution between two devices editing "the same thing" while both offline — last-reconnect-wins silently discards the other device's entire change set, not just the overlapping field. This is exactly why `transactions` being one flat, individually-addressable document per transaction (§2.1) is the right shape already — the design doesn't have a large shared blob that two devices (phone mid-import, tablet mid-categorization) could clobber.
- Denormalized "snapshot" fields (a frozen copy of a related record's display text, stored for read performance) are a real, easy-to-forget sync trap: every place that reads the frozen copy must be updated whenever the source changes, or it silently goes stale. Current design avoids this by referencing accounts/categories/tags by ID everywhere rather than copying their names into `transactions` — worth deliberately preserving this discipline rather than optimizing it away later for read-performance reasons without re-examining the tradeoff.
- Prefer live listeners (`onSnapshot`) over one-shot reads specifically for the screens with genuinely high-interaction-frequency writes (Konten's grid entry is the clear candidate) — this gets instant local-write reflection for free and avoids the flicker/revert bugs that come from manually managing optimistic UI state alongside a listener.

**Mobile vs. tablet shell — directly confirms the device-dependent-interaction approach already established for Konten (§3a):**
- One shared app shell and one CSS breakpoint switching *layout* (bottom nav on phone, sidebar/grid on tablet) — never two separate code paths or "modes." This matches the "no phone-only or tablet-only functions" requirement already in §3a; the lesson here is specifically about *how* to implement that without it silently drifting into two apps over time.
- `position: fixed` elements (e.g. a floating add-transaction button) are measured from the viewport, not from a sidebar — a naive fixed offset that works on phone can land invisibly inside a tablet sidebar's own space. Worth remembering once we get to the UI/navigation-shell discussion.

**General process discipline worth carrying over regardless of stack specifics:** ship and verify small, independent changes rather than batching risky ones together (especially anything touching auth or a live data migration); test on real phone/tablet hardware before considering something done, since several of the bugs above were invisible in a desktop browser.

---

## 1b. UI Architecture — Structure

Established before individual screens are detailed, so every screen inherits one shell/design system rather than each being styled separately and drifting apart over time — per the user's explicit goal of never needing to ask for retroactive consistency fixes.

**How the reference mockups in this spec package should be used:** each mockup (e.g. `mockup-konten.html`, `mockup-verlauf.html`) is plain HTML/CSS/vanilla JS — a throwaway proof-of-concept, not a fragment of the real app, which is built on React + Tailwind + AG Grid (§1b.1). They should **not** be ported or copied into the real codebase. Their purpose is to make specific behaviors and layouts concrete enough to sign off on — column order, color semantics, interaction patterns like the dynamic-rowspan recompute or the independent Plan1/Plan0 breakdown toggles — so the *described behavior* is unambiguous. Every specific rule written out in this document's prose (column orders, sign/arrow logic, currency formatting, lock/toggle behavior, etc.) is the actual requirement and should be implemented faithfully in the real stack's idioms (e.g. AG Grid's own column/row APIs, React state instead of manual DOM class toggling) — not reproduced by copying the mockup's markup or CSS structure.

### 1b.1 Tech stack

The user is a non-programmer ("vibe coder") directing AI-assisted development, and Konten specifically needs to genuinely compete with Google Sheets as a keyboard-navigable, sortable/filterable grid — this requirement pushes away from the prior project's plain-ES-modules-via-CDN approach, and the tradeoff is worth stating explicitly rather than silently inheriting it:

- **Framework: React + Vite.** A bundler is justified here specifically *because* of the grid requirement — building genuinely performant cell-to-cell keyboard navigation, virtualized scrolling for a long transaction list, and consistent component reuse across screens is dramatically harder to get right and keep consistent in hand-rolled ES modules than in a component framework with a mature ecosystem. React is also the best-supported target for AI-assisted (Claude Code) development and maintenance going forward, which matters more here than it would for a solo professional engineer.
- **Styling: Tailwind CSS**, using design tokens (CSS custom properties for the semantic color palette, spacing, typography scale — see §1b.4) rather than one-off component styles, so "the standard" is enforced structurally, not by memory.
- **Grid: AG Grid (Community edition)** for Konten specifically — it's a mature library built exactly for this problem (spreadsheet-like arrow-key/Tab cell navigation, sorting, filtering, inline editing, virtualized rendering for long lists) rather than something to build from scratch. Verlauf's category×month grid, while structurally simpler, reuses the same grid engine/interaction pattern (§1b.3) rather than a separate hand-built table, so keyboard behavior and visual language stay identical between the two screens the user will use most.
- **PWA tooling: `vite-plugin-pwa` (Workbox-based)** rather than a hand-written service worker — Workbox's built-in strategies already implement several of the lessons-learned rules correctly (network-first navigation, cache expiration, allowlisting), which is safer than re-deriving them by hand; the SDK-specific gotchas (Firebase Auth's own network calls, `navigator.onLine` unreliability) still need the explicit mitigations from §1a layered on top, since those are Firebase/Auth-internal behaviors, not service-worker-level ones.
- **Backend: Firebase Auth + Firestore**, as already assumed throughout this spec — single-admin auth simplifies the security rules considerably relative to the source lessons-learned material (§1a). **Hosting: GitHub Pages, not Firebase Hosting** (decided Sept 2026, superseding an earlier assumption) — Markus already has a proven GitHub Pages + Firestore pattern from prior projects, and prefers not to add a second hosting account for a single-admin app with no need of its own for a dedicated custom domain. Firebase Auth/Firestore themselves don't care where the static files are served from — Firebase Auth's authorized-domains list is just updated to trust the GitHub Pages URL. One concrete consequence: the app is built as a single static page with all screen navigation handled inside React state, never changing the browser's URL — this sidesteps GitHub Pages' lack of Firebase Hosting's SPA-rewrite config (no server-side fallback needed for a deep-linked route, because there are no separate routes to deep-link to).

**Practical implications of this stack, since you're directing rather than writing this code yourself:** Node.js/npm needs to be part of the dev environment (same category of tool as your existing Claude Code/git workflow); AG Grid's free Community edition covers everything specified in this document (sorting, filtering, keyboard nav, inline editing) — its paid Enterprise tier is not needed and shouldn't be reached for without a deliberate reason; the app compiles to a build artifact via Vite rather than being a single hand-editable file, which is invisible day-to-day but worth knowing about.

**No overscroll / pull-to-refresh (§1 requirement — concrete fix, not just a wish):** `overscroll-behavior: none` on the page's scroll container, plus `touch-action: pan-y` (or more targeted, per element, where horizontal gestures matter — e.g. a swipeable card) prevents the rubber-band bounce and accidental pull-to-reload common in mobile web views. Standard CSS, no library needed — just something that has to be deliberately set, since it's not the browser default.

### 1b.2 Navigation shell

**Phone (bottom nav bar, 5 items):** Dashboard, Konten, Verlauf, Planung, More.
**Tablet (left sidebar, all items visible, no "More" collapsing needed):** Dashboard, Konten, Verlauf, Planung, Quickview, Fortschritt (§3j — working name), Monatsabschluss (§3h), Außenstände (§3g — generalized: replaces the earlier separate Reisekosten/CPAM/loan-tracker items), Import/Export, Settings.

"More" (phone) / the extra sidebar items (tablet) resolve to the same destinations — this is a layout difference, not a capability difference, consistent with the "no phone-only or tablet-only functions" principle already established for Konten (§3a) and generalized here to the whole app.

**Dashboard — corrected/finalized structure: individual cards, each opening its own detail view.** Prognose and Status have no mockups and no separate nav-reachable screens of their own (confirmed) — their content *is* what Dashboard shows; there is no "open Prognose" destination beyond what's described here. Structure:
- **Alerts band, pinned above the card grid, not itself a card** — surfaces open Außenstände, allocation-tag mismatches, and anything else from the live-check family, since these need to be seen immediately, not discovered by tapping into something. Unchanged from before.
- **A grid of individual cards below it**, each a condensed view of one graph/section, tap to open a **detail view** with fuller data and more control over filters/display settings than the card itself shows. Confirmed cards:
  - **Prognose year-progression chart** (Plan0/Plan1/Prognose lines with Sparkonten/Geldanlage background series, §3d) — the primary/largest card, consistent with its earlier "hero visual" role.
  - **Yearly balance summary** (§3d) — Jahresanfang → Einnahmen → Ausgaben → Jahresende, broken down by allocation tag, with Plan0/Plan1/Prognose overlaid. Previously described as living "inside Prognose" with no real destination to live in — now a card of its own.
  - **Fund-location chart** (§3d) — for each allocation tag, which account(s) actually hold its money and in what proportion. Same correction as above — now a card of its own rather than an orphaned sub-chart.
  - **Status** (§3f) — condensed to a **selection, not the full list** (e.g. only the most-deviating categories), consistent with the general card principle; tapping opens the full category list with pacing detail.
  - **Quickview** — a doorway card only, no chart of its own, opening to whatever was last selected — this was already the existing behavior, now just formalized as one instance of the same general card pattern rather than a special case.
- **Exact filter/display controls available inside each detail view are not yet designed** — parked as a follow-up, not blocking; the card-and-detail-view structure itself is what's resolved here.
- Confirmed priority order within the card grid: Prognose's chart first/largest, everything else secondary — same relative priority as before, just restructured into cards.

**Reference mockup:** `mockup-dashboard.html` — tablet and phone. Alerts band shows Außenstände's real open 2026-05 HAM item (−336,50 €, same figure as the Außenstände mockup) plus a Rücklagen-check mismatch, each tappable straight through; the Prognose hero chart is shaped after the real year-progression pattern from your screenshot (illustrative values); Status shows a condensed set of the §3f pacing bars; Quickview is a plain shortcut card, not a chart.

### 1b.2a Global year selector

A single year selector lives in the app shell header (not per-screen), and drives every year-scoped view: **Konten** (as a filter over the otherwise-continuous transaction list — useful once several years of history pile up), **Verlauf**, **Planung**, **Prognose**, **Status**, and **Quickview**. It **defaults to the current calendar year** on open. To plan next year, the user simply switches this selector to that year and starts working directly in Verlauf — Planung then shows it (against the now-prior year) as soon as Plan0 data exists for it, with no separate "start planning" step. Neither Plan0 nor Plan1 is ever locked, for any year, past or present — the soft confirm-to-edit prompt on Plan0 (§2.7) is the only friction, and even a stronger safeguard against accidental edits to old years is parked for later consideration, not required now.

### 1b.3 Standardized header + grid pattern

**Header:** every screen gets the same fixed-height top app bar — screen title, an offline/sync status indicator, and a badge for any currently-failing live consistency check (§2.8a) — so the eye always knows where to look for "is something wrong," regardless of which screen is open. Below that shared app bar, each screen may have its own secondary content region (Konten's pinned balance dashboard, Quickview's Budget/Prognose line) — same visual treatment (typography, spacing, card style) even though the content and size genuinely differ by screen (Konten's is large; most others are a single line). Consistency is in the *treatment*, not a forced identical height where the content doesn't warrant it.

**Grid component:** one shared underlying grid engine (AG Grid, §1b.1) powers both Konten and Verlauf, configured differently per screen (Konten: full sort/filter/inline-edit spreadsheet; Verlauf: fixed category rows × month columns, editing constrained by the Plan0 soft-lock and breakdown-line rules from §2.7). Same keyboard navigation, cell selection styling, and sort/filter affordances in both — learning one teaches the other.

### 1b.4 Color semantics (resolved)

Red is reserved **exclusively** for alerts — overspend, a failing reconciliation check (§2.8a), anything needing attention — never used to label a category *type*. Category type gets its own distinct, calmer palette instead, so an alert is always immediately legible as "wrong" without competing with a section merely *being* an expense:
- **Blue** — computed account totals (unchanged from the Gsheet convention).
- **Green** — income (unchanged).
- **Amber/orange** — expenses (replaces the old red-as-expense-section habit).
- **Purple** — savings/investment transfers (unchanged).
- **Yellow** — "incomplete, needs categorization" (Konten's existing convention, unchanged, and visually distinct enough from amber/orange to not be confused with the expense-type color).
- **Red** — alerts only, everywhere, always.

### 1b.5 Light/dark mode
Both supported, following system preference by default with a manual override in Settings. Implemented via CSS custom properties for every semantic color (§1b.4) rather than hard-coded per-component colors, so a token's meaning (e.g. "alert red") maps to an appropriate concrete shade in each theme without every screen needing separate light/dark styling work.

### 1b.6 Typography
Two families: **Inter** for interface text (labels, categories, navigation), **a tabular/monospace numeral face** (e.g. JetBrains Mono) for every currency figure in the app. This is a deliberate, brief-driven choice rather than a decorative one: a cent-precision financial grid needs its amount columns to visually align digit-by-digit, which proportional numerals don't reliably do — this matters most in Konten and Verlauf's dense grids, but is applied everywhere for consistency (§1b's whole premise).

**Reference mockup:** `mockup-konten.html` (delivered alongside this spec) shows this system applied to Konten specifically — tablet (sidebar + grid) and phone (bottom nav + cards) side by side, light/dark toggle included. Demonstrates: the pinned balance panel, the split-transaction two-column pattern (tablet) vs. tap-to-expand card (phone), the yellow needs-attention row, a red alert badge (reserved exclusively per §1b.4), a purple allocation-tag pill, and a focused-cell outline illustrating the keyboard-navigable grid state. Intended as a concrete visual reference for Claude Code, not final pixel-perfect production styling.

### 1b.7 Density by device
**Tablet** (primary work device): more information visible simultaneously at the same font size/touch-target size — more grid columns, all 12 months at once, larger visible row count — since this is where the bulk of categorization/planning work happens.
**Phone:** fewer columns/condensed views by default (tap to expand a row for full detail), sized for occasional corrections and quick lookups (e.g. finding one transaction) rather than sustained data-entry sessions — consistent with how Konten's phone-vs-tablet split was already defined (§3a).

---

## 2. Data Model (Firestore)

### 2.1 Design principles
- **One document per transaction**, not one row per leg (replaces the old "two lines, same value, opposite sign" Gsheet pattern).
- **Accounts are a flat collection** with optional `parentAccountId`, so envelopes/sub-accounts fall out of the same structure as real accounts — no separate modeling needed.
- **Balances are always computed, never stored — all-time, no yearly reset:** `balance(accountId, asOfDate) = Σ incoming − Σ outgoing`, both filtered to `date <= asOfDate`, running continuously from the true start of tracked history with no lower bound and no per-year restatement. There is exactly **one** `Jahresabschluß` opening-balance transaction per account, ever — dated to the start of the earliest imported year (§2.3) — not one injected every year. A given year's `Jahresanfang`/`Jahresende` (used throughout Prognose, §3d) are therefore **computed lookups** against this same continuous balance (`Jahresanfang(year N) = balance(account, asOfDate = Dec 31 of year N−1)`), not separately stored values — consistent with §2.8's in-memory computation model, not a special case of it.
- **Amounts stored as integer cents**, never floats, to guarantee cent-precision with no rounding drift.
- Two old Gsheet mechanisms are **retired** as no longer necessary once transactions are atomic documents with explicit `fromAccountId`/`toAccountId`:
  - **"Rücklagen" as a category** (previously mirrored against Unterkonten balances to force consistency) — the Unterkonto account balance itself now carries that meaning.
  - **"Ohne" as a placeholder account** (previously used for internal transfers between Unterkonten that don't touch a real cash account, e.g. Sparen Julia → Sparen Sophia) — no longer needed, since a transaction can have both legs be virtual/envelope accounts directly.
- **"Envelope" accounts are retired as a concept and replaced by allocation tags** (see §2.5). The old Gsheet mixed three different things — real accounts, budget categories, and sub-pots — into one field, which was confusing by the user's own account ("a real mind fuck"). What looked like sub-accounts (Sparen Familie/Sophia/Julia, Rücklagen Steuern, Anlage Familie/Sophia) never had their own bank statement — they were always a subdivision of a real account's (or a group of virtual accounts') balance. Modeling them as **tags with a declared reconciliation target** instead of pseudo-accounts removes the duplication and lets the same tag mechanism serve allocation, trip/project grouping, and claim/statement grouping uniformly — while still allowing different UI treatment and KPIs per use case.

### 2.2 `accounts` collection
```
id, name
group: "cash" | "payment" | "savings" | "investment-cash" | "investment-tracking"
       | "physical-cash" | "receivable" | "system"
reportingGroup: "Barkonten" | "Sparkonten" | "Geldanlage" | null   // null for Jahresabschluß only
parentAccountId: null | <id>
isVirtual: boolean       // true for Aktien, Crypto, Edelmetalle, ESOP — tracks cost basis only, not market value
tracked: boolean         // false = account exists conceptually but isn't actively used yet (e.g. Giro Sophia)
```
(The `envelope` group is retired — see §2.1 and §2.5 for the allocation-tag replacement.)

`reportingGroup` is the user's own top-level mental model, distinct from the technical `group` field: **Barkonten** = anything freely/easily movable to cash, including the investment-cash settlement accounts and receivables (money not yet arrived is still "cash," liquidity-wise); **Sparkonten** = the two Livrets; **Geldanlage** = the four investment-tracking accounts only (Aktien, Crypto, Edelmetalle, ESOP) — not their settlement accounts.

**Populated accounts:**

| Account | group | reportingGroup | parentAccountId | Notes |
|---|---|---|---|---|
| BNP Konto | cash | Barkonten | – | main account France, receives salary |
| DKB Konto | cash | Barkonten | – | Girokonto Germany, manually entered |
| PayPal | payment | Barkonten | – | |
| Visa Airbus | payment | Barkonten | – | business credit card |
| Livret A Sparen | savings | Sparkonten | – | subdivided by allocation tags Sparen Familie/Sophia/Julia, Rücklagen Steuern (see §2.5); previously referred to as "Livret A Famille" earlier in this doc — same account, name reconciled |
| Livret A Tagesgeld | savings | Sparkonten | – | subdivided by allocation tag `Tagesgeld` (§2.5) — currently 1:1 (tag balance == account balance), modeled as a real tag anyway since it may be split into further sub-tags later |
| Consors-Verrechnungskonto | investment-cash | Barkonten | – | freely movable to/from BNP/DKB |
| Smartbroker-Verrechnungskonto | investment-cash | Barkonten | – | freely movable to/from BNP/DKB |
| Coinbase-Verrechnungskonto | investment-cash | Barkonten | – | freely movable to/from BNP/DKB |
| Bar Markus | physical-cash | Barkonten | – | |
| Bar Julia | physical-cash | Barkonten | – | |
| Bar Haus | physical-cash | Barkonten | – | |
| CheqVac (chèques vacances) | physical-cash | Barkonten | – | voucher balance |
| eCESU | physical-cash | Barkonten | – | voucher balance |
| Aktien | investment-tracking | Geldanlage | – | isVirtual: true; cost basis only, no market value tracking; combined pool subdivided by allocation tags Anlage Familie/Sophia |
| Crypto | investment-tracking | Geldanlage | – | isVirtual: true; part of the same Anlage Familie/Sophia pool |
| Edelmetalle | investment-tracking | Geldanlage | – | isVirtual: true; part of the same Anlage Familie/Sophia pool |
| ESOP | investment-tracking | Geldanlage | – | isVirtual: true; Airbus shares; part of the same Anlage Familie/Sophia pool |
| Amazon Julia (FR) | receivable | Barkonten | – | |
| Amazon Julia (DE) | receivable | Barkonten | – | |
| Amazon Markus (FR) | receivable | Barkonten | – | |
| Amazon Markus (DE) | receivable | Barkonten | – | |
| CPAM | receivable | Barkonten | – | money to claim back; consists of individual bookings (see §2.4) |
| Reisekosten Airbus | receivable | Barkonten | – | travel expenses to be reimbursed; individual bookings roll up to a claim |
| Geld verliehen/geliehen | receivable | Barkonten | – | loans given/received; excluded entirely from yearly budget/expensable-income planning (§2.7); expected to net to zero over time, even across year boundaries |
| Giro Sophia | cash | Barkonten | – | tracked: false — exists but not yet active |
| Jahresabschluß | system | null | – | bookkeeping plug for year-end rollover (see §2.3) |

### 2.3 Year-end rollover — corrected: one anchor, not one per year

**Superseded — the original mechanism double-counted balances from the second tracked year onward** (caught in external review, Sept 2026): injecting a fresh `Jahresabschluß → account` transaction every Jan 1, on top of an already-continuous all-time running balance (§2.1), restated history that was already implicit in the transaction sum — every account's balance would read double by year two.

**Corrected mechanism:** exactly **one** `Jahresabschluß → account` transaction per account, ever, dated to the start of the **earliest imported year** (e.g. 2025-01-01, given the migration now covers 2025 and 2026 — §4/PLAN.md Phase 1a), carrying that account's true balance at that point in time. No further Jahresabschluß transaction gets created for any later year — 2026, 2027, and onward just continue the same unbroken running sum. A year's `Jahresanfang`/`Jahresende` for reporting purposes (Prognose, §3d) are computed on demand from this continuous balance, never stored per-year.

### 2.4 `categories` collection
```
id, name, parentCategoryId
isFixkosten: boolean   // true for Steuern, Krankenkasse, Hauskredit, Rente — fixed cost outside discretionary planning control; permanent property of the category, not per-year. Acknowledged explicitly (caught in external review, Sept 2026): toggling this retroactively changes what a *past* year's `Budget` figure computes to, since §3c's formula sums Σ Fixkosten — same accepted tradeoff already stated for `parentCategoryId`'s live restructuring (§3i), now stated here too rather than left implicit.
```
11 groups, each with fixed subcategories (person-specific subcategories kept as named, e.g. "Gehalt Julia", "Hobbys Sophia", "Klamotten Markus" — person is not a separate field, it's baked into the subcategory name, by design). Full list, transcribed from the Gsheet's own reference tab:

- **Einnahmen** — Erstattungen, Gehalt Julia, Gehalt Markus, Kindergeld, Sonderzahlungen, Sonstige Einnahmen
- **Wohnen** — Einrichtung, Garten, Hauskredit, Instandhaltung, Nebenkosten
- **Kommunikation** — Fernsehen, Internet, Telefon
- **Mobilität** — Autoversicherung, Firmenwagen, Gebühren, Tanken, Wartung
- **Lebenshaltung** — Allgemein, Ausgehen, Ausstattung Sophia, Haustiere, Kantine, Klamotten Julia, Klamotten Markus, Klamotten Sophia, Lebensmittel & Haushalt, Versicherungen
- **Gesundheit** — Arztkosten, Krankenkasse, Medizin
- **Hobbys** — Hobbys Julia, Hobbys Markus, Hobbys Sophia
- **Sonstiges** — Geschenke, Rente, Sonderausgaben, Sonstige Ausgaben, Steuerausgaben, Urlaube

The Gsheet's own reference tab also lists three more columns — **Rücklagen**, **Außenstände**, and **Unterkonten** — but these are exactly the three groups already retired as categories (line below) and expressed structurally instead: Rücklagen's items (Für Tagesgeld, Für Steuern, Für Sparen Familie/Sophia/Julia, Für Anlage Familie/Sophia) are the `savings-transfer` budget rows tied to allocation tags (§2.5, §2.7), not category rows; Außenstände's items (Geld verliehen, Geld zurück) are the receivable-account + claim-tag mechanism (§3g); Unterkonten's items are the allocation tags themselves (§2.5). So this transcription is complete for the 8 real category groups — nothing further to transcribe there.

**Resolved — a 7th allocation tag, `Tagesgeld`, exists** (spotted in this transcription's "Für Tagesgeld"/"Tagesgeld" entries), reconciling against **Livret A Tagesgeld**. Confirmed even though the tag and the account currently hold identical totals 1:1 — modeled as a real allocation tag now rather than skipped, since Livret A Tagesgeld may be split into further sub-tags later, and having the tag already in place makes that a future Settings-area addition (§3i) rather than a schema change. Added throughout (§2.5, §2.8).

**Retired as categories** (now expressed structurally via account `group` instead): Rücklagen, Unterkonten, Außenstände.

### 2.5 `tags` collection

Tags are technically uniform — one collection, one mechanism — but serve genuinely different purposes depending on **class**. The class doesn't change the data structure, only which UI/KPIs treat the tag specially.

```
id, name, parentTag: null | <id>
class: "allocation" | "grouping"
reconciliationTargetAccountIds: [<id>]   // allocation tags only — which account(s) this tag subdivides
groupingType: null | "project" | "statement" | "claim" | "claim-category"   // grouping tags only — purely for color-coding/UI grouping and sequencing (see below); no other behavioral difference
archived: boolean   // hide from autocomplete/pickers once a trip/claim/statement is fully wrapped up, without losing history on already-tagged transactions
```
(`claimStatus` — considered, then dropped: see §3g. `parentTag` stays unused by the claim/claim-category mechanism specifically: every claim-category tag like "Meal" or "Taxi" is a single shared, reusable tag across every trip, not an instance tied to one specific trip tag, so there's no genuine parent/child relationship there to encode. `parentTag` **is** used for genuinely instance-specific hierarchies — see the breakdown-line rollup mechanism in §3b, e.g. `Hotels`/`Flüge`/`Auto` as real children of a specific trip tag like `Schottland`, formalizing what used to be only a naming convention.)

**Tag creation and management — two very different lifecycles depending on class:**
- **Allocation tags are fixed and pre-seeded**, not something created casually while entering a transaction. Creating one means declaring a real reconciliation target (§2.8/§2.8a depends on this being set up correctly), so this is a deliberate Settings-area action — the seven existing ones (Sparen Familie/Sophia/Julia, Rücklagen Steuern, Anlage Familie/Sophia, Tagesgeld) are the expected complete set; adding an eighth should feel like a structural decision, not a typo.
- **Every grouping tag — including `claim-category` — is created inline, on the fly**, exactly where the user is already working: while tagging any transaction line, an autocomplete field always offers existing tags first and, if nothing matches, "Create tag '2026-06 HAM'" — no separate setup step required before a new trip code, claim reference, statement label, or claim category can be used. This applies uniformly across all four grouping types; nothing is Settings-managed the way allocation tags are. Examples confirmed: `2026-06 HAM` (Airbus travel claim), `GW1298747` (CPAM claim reference), `2026-08` (a Visa Airbus statement grouping), `Meal`/`Taxi`/`Hotel` (Airbus claim categories) — the grouping-tag examples are exactly what "reference" was trying to be as a separate field (§2.6's dropped `reference` field is superseded by this — grouping tags are the correct mechanism, not a distinct field).
- **`claim-category` tags are only offered once a `claim`-type tag is already present on that same line** — a UI sequencing rule (don't show "Meal"/"Taxi" as options until the line is already part of some trip/claim), not a data-level hierarchy. Outside that context, claim-category tags aren't offered at all.
- **A small Tag-management screen (Settings area)** covers what inline creation doesn't: renaming a tag, merging two accidental duplicates, and archiving a tag once its trip/claim/statement is fully closed out (removes it from autocomplete without touching already-tagged transactions' history).

**Tag color-coding, extending §1b.4's semantic palette with a tag-specific layer:**
- **Allocation tags** — purple (unchanged from §1b.4; they already have a fixed, structural meaning).
- **Grouping / `project`** (trip, project labels like `Schottland`) — teal.
- **Grouping / `statement`** (e.g. `2026-08` Visa statement grouping) — slate/neutral gray.
- **Grouping / `claim`** (e.g. `2026-06 HAM`, `GW1298747`, an informal loan like `Dirk Sept` — §3g's generalized Außenstände) — indigo.
- **Grouping / `claim-category`** (e.g. `Meal`, `Taxi`, `Hotel`) — rose (a new hue, distinct from every other tag/semantic color already in use).
- **Grouping / unspecified** (`groupingType: null`, not yet categorized) — plain neutral gray, same family as `statement` until deliberately typed.
This gives an at-a-glance visual distinction between "this is structural/reconciled" (purple) vs. "this is one of my own ad-hoc groupings" (everything else), and among the ad-hoc ones, what kind of grouping it is — without inventing a whole new color axis that competes with §1b.4's alert/type semantics.

**`allocation` tags** — replace what used to look like sub-accounts/envelopes. An allocation tag declares which real or virtual account(s) it subdivides, so the app can reconcile "sum of everything tagged X" against "balance of the account(s) X subdivides":
- `Sparen Familie`, `Sparen Sophia`, `Sparen Julia`, `Rücklagen Steuern` → each subdivides **Livret A Sparen**. Consistency check: `Σ balance(these 4 tags) == balance(Livret A Sparen)`.
- `Anlage Familie`, `Anlage Sophia` → each subdivides the combined pool **{Aktien, Crypto, Edelmetalle, ESOP}**. Consistency check: `Σ balance(these 2 tags) == Σ balance(Aktien, Crypto, Edelmetalle, ESOP)`.
- `Tagesgeld` → subdivides **Livret A Tagesgeld**. Today this is a 1:1 tag-to-account relationship (the tag and the account currently hold the same total), but modeled the same way as every other allocation tag rather than skipped, since Livret A Tagesgeld may itself be split into further sub-tags later — having the tag in place now means that's a Settings-area addition later (§3i), not a schema change. Consistency check: `balance(Tagesgeld) == balance(Livret A Tagesgeld)`.
- A transaction contributes to an allocation tag's "balance" by being tagged with it — e.g. BNP → Livret A Sparen, €100, tagged `Sparen Sophia`.

**`grouping` tags** — cross-cutting collections of transaction *lines* (§2.6 — tags live on the line, not the transaction root) that don't reconcile against any account balance, just sum for a view. Covers trip/project tags (`Schottland`, `Schottland:Unterkünfte`), statement-grouping tags (all lines from one Visa Airbus statement), claim tags (all lines belonging to one CPAM claim, one Airbus travel-expense claim, or one informal loan — §3g), and claim-category tags (which specific kind of expense a claim-tagged line represents).

**Category-breakdown tags** (e.g. `Schottland:Unterkünfte` used as a detail line under the Urlaube category in Verlauf) are `grouping` tags — same mechanism as a trip tag, just also referenced from a `budgets` breakdown line (see §2.7). No separate tag type needed — a tag can simultaneously serve as a plain grouping label and as the thing a budget breakdown line targets, that's the intended 1:1 link.

Independent of category — a transaction line carries both a category (for the ledger/budget structure) and optionally one or more tags of either class (unlimited, no fixed count).

### 2.6 `transactions` collection
```
id
date: "YYYY-MM-DD"                // a plain calendar-day string, NOT a Firestore Timestamp — a booking date is a day, not an instant; stored as a Timestamp it would drift into the wrong year depending on device timezone (caught in external review, Sept 2026)
fromAccountId: <id> | null        // null = external income source
toAccountId: <id> | null          // null = external expense
amountCents: integer              // SIGNED — negative = outflow from fromAccountId, positive = inflow to toAccountId. Once a transaction has more than one line, this is a cached total (see invariant below) — every category/tag/budget aggregation runs off lines[], never this field.
rawDescription: string            // untouched original bank CSV text — never overwritten
displayLabel: string              // friendly label, auto-suggested or manually editable
lines: [
  { amountCents: integer, categoryId: <id>, note: string, tags: [<tagId>] }   // SIGNED, same convention as the parent — a line can be positive or negative independent of the parent's own sign (e.g. an Airbus salary deposit splitting into a positive Gehalt line and a negative Steuern line). categoryId points to the leaf subcategory (e.g. "Lebensmittel & Haushalt"); its parent group ("Lebenshaltung") is derived via parentCategoryId, not stored redundantly. tags live here, not on the transaction root, so a claim/category/allocation tag can apply to just one line of a split (e.g. only the claimable portion of a grocery run)
]
detail: string
createdAt
```
**`status` ("settled" | "open") is not a stored field — computed in-memory per §2.8**, not written to the document. Earlier drafts of this spec stored it, which is exactly the denormalized-snapshot bug §1a warns against, applied to itself.

**Clarification, found ambiguous while building the Phase 1a migration (Sept 2026): `amountCents`'s sign is evaluated per-side by account position, not applied identically to both sides.** For a transaction touching two real accounts (a transfer), `balance(X)` must not add the same signed `amountCents` to both `fromAccountId` and `toAccountId` — that double-applies the sign and gets one side backwards. The correct, universally-consistent rule (matches the "negative = outflow / positive = inflow" framing for every case, including plain single-sided expense/income transactions): `balance(X)` treats a transaction as contributing `−|amountCents|` if `X == fromAccountId`, and `+|amountCents|` if `X == toAccountId` — magnitude plus directional sign from the account's own position, never the field's raw stored sign applied to both sides. This is how `balance()` (§2.8) must be implemented; noted here since it's easy to get backwards on the transfer case specifically.
**Split-transaction invariant — unchanged by amounts now being signed:** `amountCents` (the parent) must always equal `Σ lines[].amountCents` — enforced live while splitting, not just checked afterward, via the same auto-remainder-line mechanism as before (§3a): the live remainder is just `parent − Σ(lines entered so far)`, arithmetic that works identically whether the values involved are positive or negative. So this is never a background risk of drift. Account-balance movement and lines-based aggregation are therefore always in agreement by construction — not two separate sources of truth that happen to match, but one number two ways.

(A separate `reference` field — for a formal check/invoice/confirmation number — was considered but superseded: examples like `2026-06 HAM` or `GW1298747` are grouping tags with `groupingType: "claim"` (§2.5), not a distinct field. `detail` remains for genuinely freeform notes. `claimCategory` as a dedicated field was considered and dropped the same way — superseded by `claim-category` grouping tags (§2.5) living in the same `tags[]` array as everything else, rather than a second, parallel field.)

**Open items (receivables/payables):** loans, CPAM claims, and Airbus travel expenses are transactions pointing to/from the relevant `receivable` account, whose computed `status` (§2.8) resolves to `"open"` until their tag nets to zero. Filtering the in-memory loaded set to `status == "open"` surfaces every outstanding item regardless of how far apart in time the two sides are — replacing the old problem of manually hunting across a long flat sheet (e.g. money lent in March, repaid in June).

**CPAM / travel expenses specifically:** a claim is a set of individual bookings (hotel, flight, food, etc.) that together make up one lump-sum reimbursement. **Resolved (§3g):** generalized into the Außenstände mechanism — same tag-based net-zero closure used for Reisekosten, informal loans, and Amazon returns, not a separate CPAM-specific system.

### 2.7 `budgets` collection
```
id
year
month: null | 1-12                    // null = annual lump sum (e.g. one-off insurance payment)
planVersion: "plan0" | "plan1"
type: "expense" | "savings-transfer"  // savings-transfer targets an allocation tag instead of pretending to be an expense category
categoryId: null | <id>               // required when type == "expense"
allocationTagId: null | <id>          // required when type == "savings-transfer" — e.g. Sparen Sophia, Anlage Familie
breakdownTagId: null | <id>           // optional — present when this row is a detail/breakdown line under categoryId (grouping-class tag)
plannedAmountCents: integer
note: string                          // free-text commentary on this specific line, independent of tags — always available regardless of breakdown structure
```
`regularSharePercent` and `pacingMode` are no longer here — see §2.7c, a fix from external review (Sept 2026): both are genuinely single values per category-year, with no one month among the 12 `budgets` documents that's naturally "the" place to store them.

### 2.7c `categoryYearSettings` collection — new, resolves the "which month's document" ambiguity above
```
id
year
categoryId: null | <id>               // exactly one of categoryId/allocationTagId set, same convention as budgets
allocationTagId: null | <id>
regularSharePercent: null | integer   // 0-100, Plan0-only — nullable override; when null (the default, and the only path built for now), the app computes it live via the median-based formula in §2.8 rather than storing a value at all. Applied as-is when Plan1 or Prog is being viewed in Planung (§3c) — it describes funding timing, not a re-plan of the category itself.
pacingMode: "fixed-profile" | "yearly-rolling" | null   // deliberate planning choice — see §3f (Status)
```

**Two planning lines, one locked:**
- **Plan0** is set once a year and is the reference — normally untouched. The app should protect it with a soft lock: editing a Plan0 value after initial entry prompts an explicit confirmation ("really change Plan0?") rather than a hard permission barrier; no separate unlock step is required, just a deliberate extra click.
- **Plan1** is the working forecast, adjusted through the year as real decisions are made (unplanned spend, reallocations). It's what actually drives the year-end prediction.
- Both `plan0` and `plan1` rows exist for every category/breakdown line, always in parallel, so any breakdown line added under Plan1 must also get a symmetrical Plan0 row (see breakdown-line mechanism below).

**Savings-transfers stay part of budget planning, not just automated reporting:** the user deliberately treats money moved into savings/investment as competing against the same "expensable income" pool as real expenses (how much can go to savings depends on what's left after all expenses) — so `type: "savings-transfer"` budget rows are planned in Plan0/Plan1 exactly like expense categories, just targeting an `allocationTagId` instead of a `categoryId`. The actual/prognosis side is then a pure automatic rollup: `Σ transactions tagged <allocationTagId>` — no manual re-entry of what already happened.

**Breakdown-line mechanism (category detail rows, e.g. Urlaube → Schottland Unterkünfte / Flug & Auto / ...):**
- Any category can optionally have breakdown lines; this is never pre-declared or required — the user adds them freely, for any category, at any time (only ~95% predictable in practice, per the user).
- **No breakdown lines:** the category's Plan0/Plan1 values are edited directly on the top-line row (`breakdownTagId: null`).
- **Breakdown lines exist:** the category's top-line Plan0/Plan1 value becomes **computed** as the sum of its breakdown-line rows (`Σ budgets where categoryId == X AND breakdownTagId != null AND planVersion == Y`), matching the user's Gsheet convention where Plan1 already is that sum.
- **Adding the first breakdown line to a previously-unbroken category must not lose data:** whatever value was already manually entered on the top-line row is automatically pushed into the newly created first breakdown line (pre-filled, user-editable from there), rather than being discarded or silently zeroed. This must happen symmetrically for Plan0 and Plan1 so the 1:1 tag linkage holds for both.
- A small variance between a category's computed Plan1 total and its actual/prognosis is expected and fine (a few euros of untracked detail); a persistent or large gap is the signal to go back and adjust Plan1, not something the app auto-corrects.

**Breakdown-group automated actuals ("Schottland (automatisch)" header rows) — a parent-tag rollup, not a third row per line:** resolved after walking through the manual-vs-automatic clash directly. Individual breakdown lines (`Schottland: Hotels`, `Schottland: Flüge`, `Schottland: Auto`) stay exactly as they are — Plan1/Plan0 values entered by hand, never touched by actuals, never overwritten. What's new: where several breakdown lines under one category share a common **parent tag** (§2.5 — `Schottland` as the real parent of `Hotels`/`Flüge`/`Auto`, formalized via `parentTag` rather than the old colon-in-a-string naming convention), Verlauf shows **one additional computed row per parent**, positioned as a header directly above its own children, **inside Plan1's breakdown block only** (Plan0's breakdown lines stay untouched, since Plan0 is the fixed once-a-year reference rarely revisited monthly, while Plan1 is what's actively steered):
```
Schottland (automatisch)
  Schottland: Hotels
  Schottland: Flüge
  Schottland: Auto
```
This header follows the **same mirror-then-lock-in rule as every other Prog value** in this spec: before a month closes, it mirrors the sum of its children's Plan1 values for that month; once the month closes, it becomes `Σ transactions where categoryId == X AND tags array-contains parentTagId OR any of its children's tagId, dated in that month`. So a planned 200€ (Schottland:Hotels, Plan1, May) sitting next to a real 180€ (Schottland (automatisch), May, once closed) is the intended, permanent, side-by-side state — not a conflict to resolve, and not something the app reconciles for the user. Seeing that gap is what lets the user decide, by hand, whether to shift the remaining 20€ into June's Plan1 or treat it as a saving.
- **A breakdown line with no parent tag gets no automated row** — the rollup only fires where there's a real parent/child grouping to roll it up into; a flat, standalone breakdown line is covered by the category-level Prog row's existing "small variance is fine" tolerance, same as before.
- **The child tag is not merely a label, even though it now has no automated row of its own inside Verlauf.** Real Konten transactions must still be tagged with the specific child (`Schottland: Hotels`, not just `Schottland`) — that tagging is exactly what feeds the parent header's `Σ` total; an untagged child contributes nothing to it. The child tag also stays fully live in Quickview (§3e) and anywhere else tags are queryable — selecting `Schottland: Hotels` there shows its own real actuals, same as any other tag. "No automation" is scoped specifically to Verlauf's own grid display, not to the tag itself.
- This keeps the addition genuinely light — one extra row per multi-line holiday/group (the user's "3–4 per category, not 10–15" concern), not one per individual breakdown line.
- **Display convenience, not a schema change:** a child tag's stored `name` can stay short (`Hotels`), with the parent's name prefixed only where needed for display (`Schottland: Hotels`) — inside its own already-grouped breakdown block, the parent context is visually obvious from the header above it, so the plain child name alone is cleaner there.

**Excluded from budget planning entirely:** `Geld verliehen/geliehen` (loans/receivables) — tracked purely via the receivable-account + open/settled mechanism (§2.6), never as a budget line, since the money is expected back and nets to zero over time regardless of year boundaries.

### 2.7a `settings` collection (per-year)
```
id (== year)
minCashBufferCents: integer   // the "hidden" minimum year-end cash target the user plans against (currently 8k); can change year to year, entered inline where relevant (Planung view)
```

### 2.7b `categorizationRules` collection (missing from the schema until now — caught in external review, Sept 2026)
§3a describes auto-categorization keyword rules that grow over time — the app suggests new candidates as manual categorization happens — but no collection was ever specified to hold them, so a rebuilt Firestore database would silently lose every rule ever accumulated, and §3k's export never covered them either (fixed there too). Real, stored data now:
```
id
keyword: string        // matched against rawDescription, e.g. "REWE"
categoryId: <id>        // the leaf subcategory this keyword maps to
source: "seed" | "user-confirmed"   // seed = the original fixed keyword list this project started from; user-confirmed = accepted from a suggested-candidate prompt
createdAt
```

### 2.8 Derived / computed (never stored) — computed in-memory from the loaded year, not via Firestore aggregation queries

**Corrected architecture (caught in external review, Sept 2026):** Firestore cannot run "transactions where any line's `categoryId == X`" against `lines[]` (an array of maps — `array-contains` matches whole array elements, not fields nested inside them), and even where a query *could* be constructed, Firestore's `sum()`/`count()`/`average()` aggregation queries are served only by the backend — they skip the local persistent cache entirely and simply fail with no network. An app whose §1 requirement is "fully usable with no network connection" cannot have its balances and rollups depend on them.

**The actual mechanism:** the selected year's `transactions` are loaded into memory via `onSnapshot` (live-updating, works identically online and offline against the persistent cache — §1a), and everything below is computed client-side over that in-memory set, not via a Firestore query of any kind. For one user at roughly 2,000–5,000 transactions a year this is trivial for a browser. If cheap root-level filtering is ever wanted later, `categoryIds`/`tagIds` mirror arrays could be added to the transaction root — not needed for the in-memory model and not built now.

- `balance(accountId, asOfDate)` = Σ incoming − Σ outgoing, up to that date, over the full loaded history (§2.1/§2.3 — all-time, not year-scoped)
- `balance(allocationTagId, asOfDate)` = Σ of each line tagged with it, up to that date, **signed by the direction of the money relative to the tag's own reconciliation-target account(s)** (clarified Sept 2026 while validating the 2025 migration against the Gsheet's own tag totals — a plain sum of tagged amounts would count money *leaving* Livret A Sparen as *adding* to its tag). On a transfer: `+line` if `toAccountId` is one of the tag's target accounts, `−line` if `fromAccountId` is. On a single-account income/expense line (e.g. interest paid into Livret A Tagesgeld, or an expense paid directly out of it), the line's own signed amount. A money movement *within* the same account never needs a transaction just to re-tag it — the Gsheet's same-account "Für X / Unterkonten X" row pairs become a tag directly on the real income/expense line instead. This reproduces all seven 2025 tag totals to the cent.
- `budget vs actual` per category/month = `plannedAmountCents` vs. `Σ lines where categoryId == X and date in month`, summed in memory over the loaded transaction set
- `tag totals` (grouping tags) = `Σ amountCents of lines carrying <tagId>`, summed in memory over the loaded transaction set
- Allocation-tag consistency check = `Σ balance(sibling allocation tags) == balance(reconciliationTargetAccountIds)` (sanity-check computation, not an enforced constraint) — e.g. Σ(Sparen Familie, Sparen Sophia, Sparen Julia, Rücklagen Steuern) == balance(Livret A Sparen)
- `regularSharePercent(categoryOrAllocationTagId, planningYear)` (when not overridden — §2.7c) = take the 12 monthly actuals for that category/allocation tag from `planningYear − 1` (always closed by the time it's used), compute their **median**, then `regulärJahr = median × 12`, `einmalJahr = referenceYearTotal − regulärJahr`, `regularSharePercent = round(regulärJahr / referenceYearTotal × 100)`. **Edge cases (caught in external review, Sept 2026 — all three resolved):**
  - **Reference year total is zero** — `regulärJahr` and `einmalJahr` both come out `0`; nothing to extrapolate a pattern from, not an error to surface.
  - **No reference-year data at all** (category/allocation tag didn't exist in `planningYear − 1`) — falls back to **100% einmalig** until a full reference year exists for it; the safe assumption is "unproven, not recurring" rather than guessing at regularity from nothing.
  - **A refund or unusual month pushes the math past its normal range** (`regularSharePercent` over 100%, `einmalJahr` negative) — **shown as computed, not clamped.** An unusual reference year is real information about that category, not noise to hide — Planung displaying `−340 € einmalig` alongside a >100% regular share is the honest reflection of what actually happened, not a bug to mask.
  See §3c for the reasoning and worked example.
- `Budget(year)` = `Σ Einnahmen categories (Plan0/Plan1/Prog, per §3c's column selector) + Σ Fixkosten categories + (Jahresanfang Barkonten − Puffer)` — total spending capacity for the year; see §3c for the confirmed worked example and its use in Planung's chart.
- `status: "settled" | "open"` (§2.6) — also computed in-memory, not stored: a line is open exactly when its claim/loan tag's signed total across every line and settlement carrying it hasn't yet netted to zero. "Signed" follows the same direction rule as allocation tags above, with the receivable accounts as the target: money flowing *into* a receivable account (lent out / paid on someone's behalf) raises the claim, money flowing *out* of it (repaid) lowers it, and a single-account line on the receivable (e.g. a §3g close-out write-off) counts by its own sign. **Routing into receivable accounts goes by who owes the money, not by where it was spent** — a loan to family for something bought on Amazon belongs to `Geld verliehen/geliehen`, not an Amazon account (caught during the 2025 migration). Validated against the 2025 Gsheet: 59 claims, 10 still open at year end, totalling exactly the sheet's own open-items figure. Storing this (as earlier drafts of this spec did) is exactly the denormalized-snapshot trap §1a warns against, applied to itself — one new settlement transaction would need to correctly flip every earlier document sharing that tag, with a silent staleness bug as the failure mode if any write were missed. Computing it avoids that class of bug entirely.

### 2.8a Cross-cutting live reconciliation (global, not tied to one screen)
Two checks the user runs mentally today at month-end, both compare a **plan-side number (Verlauf)** against an **actual-side number (Konten)**, and both must become **always-visible, real-time**, not something surfaced only in a monthly review — the explicit standard is: anything that doesn't add up should flag itself as it happens, the same way Konten's yellow "needs category" highlighting works, not discovered by manual detective work weeks later.
1. **Barkonten check:** `Σ(Barkonten reportingGroup) under Verlauf's Prog line, this month` vs. `Σ actual balance of Barkonten accounts from Konten, same month`.
2. **Rücklagen check:** `Σ actual balance of the seven allocation tags (Sparen Familie/Sophia/Julia, Rücklagen Steuern, Anlage Familie/Sophia, Tagesgeld) from Konten` vs. `Σ planned savings-transfer budget amounts from Verlauf`, same period — effectively the budget-vs-actual check (§2.7) applied specifically to savings-transfer lines.

Both checks are diagnostic tools for catching real errors early (e.g. a miscategorized transaction) — a live example surfaced a genuine, previously-unnoticed discrepancy the user hadn't caught by eye in the spreadsheet. Where exactly these surface (Konten's pinned header, a dedicated always-on banner, both) is a UI decision still open, but the requirement that they run continuously and flag immediately is firm.

### 2.9 Encryption / security note
Firestore encrypts data at rest by default (Google-managed keys). Combined with Firebase Auth restricted to the single admin user and strict security rules scoped to that user's data, this is considered proportionate protection for personal household finance data. True client-side end-to-end encryption was considered and rejected — not because it would block server-side aggregation queries (§2.8 no longer relies on those at all, corrected Sept 2026), but because key management for a non-programmer is a genuinely bad trade for the actual threat model here.

### 2.9a Data safety / undo — four layers, each proportionate to the scale of mistake it covers

Raised directly by Markus (Sept 2026) after the external review flagged Settings' merge operation as having no undo — a fair question to ask generally, not just about merge. A true generic "undo any operation" system was considered and rejected: it would need explicit, separately-tested reversal logic for every mutation type in the app, which is genuinely more engineering than the merge feature just cut for being too risky (§3i) — building something *more* complex right after cutting something for being too complex would be the wrong move. Instead, four separate, much cheaper mechanisms, each fitted to a different scale of mistake:

1. **Firestore Point-in-Time Recovery (PITR), enabled from Phase 0 (PLAN.md)** — the generic, whole-database safety net, covering literally any mistake including ones nobody anticipated (a bad CSV import, an app bug), not just the specific operations already identified as risky. With PITR enabled, Firestore retains a rolling **7-day** version history and can clone the database as of any minute within that window into a **new** database — inspectable before anything gets overwritten, not an immediate blind replace. Without PITR, Firestore still gives a free 1-hour recovery window automatically; PITR extends that to 7 days and requires billing enabled on the Firebase project (a small ongoing storage cost for the retained history — exact current pricing not confirmed, but at personal-app data volumes very unlikely to be meaningful). Must be enabled at database creation via the `gcloud` CLI specifically — the Cloud console does not support enabling it at creation time. **Tradeoff, stated plainly:** this is coarse, not surgical — recovering to a moment before one bad mistake also undoes every good change made since then. That's the honest price of "generic"; anything more surgical means inverting specific operations again, which is exactly the complexity being avoided here.

2. **AG Grid's built-in cell-edit Undo/Redo, enabled in Konten and Verlauf** — confirmed genuinely free (Community tier, not Enterprise — checked directly against AG Grid's own licensing table, Sept 2026). `Ctrl+Z`/`Ctrl+Y` (`Cmd+Z`/`Cmd+⇧Z`), covering cell edits, copy/paste, and the fill handle — 10 steps back by default, configurable via `undoRedoCellEditingLimit`. This is the answer to the highest-frequency real mistake while actively working in the app's two heaviest-use grids: a typo'd amount, the wrong category picked from a dropdown, a fat-fingered date. **Scope, stated plainly since it's easy to over-assume:** this does not cover adding or deleting whole rows, or any operation that reorders rows (sorting/filtering/grouping clears the undo stack) — it is specifically a cell-value mechanism, not a row-level one. Row-level mistakes are covered by layer 4 below, not by this.

3. **Un-archive, in Settings (§3i)** — archive already only hides an item, never destroys anything, so offering a direct restore action back to active costs almost nothing to build and covers the single most likely "oops, archived the wrong one" moment without needing any of the heavier machinery above.

4. **Soft-delete with a short recovery window** — for exactly what layer 2 doesn't cover: deleting a whole transaction row in Konten, and Settings' rare true hard-delete (only ever offered when nothing references the item, §3i). Marked with a `deletedAt` timestamp and excluded from every normal view/aggregation rather than actually removed, recoverable for roughly a week before an actual purge — cheap to build (a filter clause on already-loaded data, §2.8, not new architecture). **Recovery mechanism, previously unstated:** not a keyboard shortcut — a "Kürzlich gelöscht" toggle in Konten's existing filter bar (§3a), off by default. Switched on, deleted-but-not-yet-purged rows reappear, visually distinct (e.g. struck through/greyed), each with its own "Wiederherstellen" action that clears `deletedAt` and returns it to normal. **Layer 4 and layer 2 interact, worth stating plainly:** AG Grid's own Undo/Redo (layer 2) clears its entire stack the instant a row is deleted, by design (its docs are explicit that only cell edits are tracked, not row-level changes) — so deleting a transaction doesn't just fail to be undoable by `Ctrl+Z`, it also wipes whatever unrelated cell-edit undo history existed before it. The deleted transaction itself isn't lost — it's recoverable via the toggle above, just not via `Ctrl+Z` anymore.

---

## 3. App Sections — status

Mapped from the current Gsheet tabs, to be discussed one at a time:

| Gsheet tab | Purpose (as-is) | Spec status |
|---|---|---|
| Konten | Single source of truth, all bookings line by line | **detailed spec written (§3a) — core discussion complete, minor open points logged** |
| Verlauf | Single-page overview: category/subcategory by row, month by column, each row split into Plan 0 / Plan 1 / Actuals-Prognose | **detailed spec written (§3b) — core mechanics agreed, examples pending validation** |
| Planung | Mostly auto-fed from Verlauf; yearly budget planning per category per month; supports flagging a category as monthly-pay-funded vs. yearly-lump-funded vs. a split | **detailed spec written (§3c) — core mechanics agreed** |
| Prognose | Graphical overview: Plan 0 vs Plan 1 vs Actuals/Prognose vs Rücklagen, to predict year-end position | **detailed spec written (§3d) — core mechanics agreed** |
| (various graphs) | Different visual breakdowns | **resolved:** every graph is now accounted for — Planung's Budget-vs-Ausgaben bars (§3c), Prognose's year-progression + yearly-summary + fund-location charts (§3d), Status's pacing bars (§3f), Dashboard's consolidated hero chart (§1b.2) |
| Quickview / Deepdive | Drill-down into specific categories/months to see underlying bookings | **Quickview detailed spec written (§3e); Deepdive parked — low current usage, revisit later if needed** |
| Status | Visual per-category spend-vs-plan, normalized to 12 months (e.g. flags "you're spending like it's September when plan says August") | **detailed spec written (§3f)** |
| CPAM / travel cost special sheets | Group individual bookings (hotel, flight, food, ...) into one lump-sum claim | **detailed spec written (§3g), generalized into "Außenstände" — covers Reisekosten, CPAM (on hold), informal loans, and Amazon returns as one mechanism** |

Open question raised by Markus: the totality of existing budgeting apps tested so far don't fit his actual workflow — so sections should be designed from his actual habits/needs first, not from what typical budget apps offer. Ground rule for this whole spec process: **don't guess — ask questions** before writing anything into the spec.

---

## 3a. Konten (main ledger) — detailed spec

**Ground truth principle:** Konten reflects 100% what has actually happened on real bank statements, plus corrective/internal transactions that never appear on a statement (e.g. Sparen Julia → Sparen Sophia). Future/planned bookings are never entered here — that belongs entirely to Verlauf/Planung.

**Device-dependent entry mode:**
- **Tablet:** primary workflow is a spreadsheet-like grid — fully sortable/filterable, full keyboard cell-to-cell navigation (arrows/Tab). This is where the bulk of categorization work happens (reviewing imported CSVs, fixing up the ~30% auto-categorization missed).
- **Phone:** grid interaction isn't practical — a compact form-based entry is used instead for quick single-transaction entry.

**Import pipeline:**
1. CSV import (multiple formats/sources — BNP primarily, but the import feature must be flexible enough to handle different bank CSV formats, since maximizing automation means removing DKB's manual-entry burden over time too).
2. Auto-categorization by keyword matching against transaction description text (e.g. "Carrefour" → Lebensmittel & Haushalt), based on a fixed keyword list. Historically covers ~70% of transactions. The app should also **suggest new keyword-rule candidates** as manual categorization happens (e.g. noticing a repeated uncategorized description and proposing "add REWE → Lebensmittel & Haushalt to the rule list?"), rather than only ever using a static list.
3. A **quick review screen** confirms the import went well structurally (right number of rows, no duplicates, dates/amounts parsed correctly) — not a categorization step.
4. **Duplicate detection:** if an import overlaps previously-imported data, the app must **flag** the suspected duplicate rows for confirmation before adding — never silently skip or silently add.
5. All imported transactions then land in Konten, where the remaining ~30% get categorized manually (grid view, tablet).

**Automatic transfer-leg matching — a suggestion, not a silent merge:** this isn't part of the import pipeline specifically — it runs whenever *any* transaction is saved, manual entry or imported alike, since the two sides of a transfer are just as likely to both be typed in by hand (e.g. logging a BNP −500€ Rücklagen-Steuern line today, then a Livret A Steuern +500€ line days or weeks later) as they are to arrive via two separate bank CSVs. On every save, the app checks already-saved, still-unmatched rows on *other* accounts for a same-magnitude, opposite-sign amount within a small date window (a few days, to allow for normal inter-bank posting delay or simply getting around to entering the other side later).
- **Exactly one candidate found → suggested, not auto-merged.** The row is flagged (same visual language as any other needs-attention item) with the proposed match; one tap confirms it, merging into a single transfer transaction with both `fromAccountId`/`toAccountId` set (avoids double-counting the same movement as two separate documents) and eliminates manually picking the second account. Left unconfirmed, the row just stays as an ordinary-looking transaction. **Deliberately not automatic:** a coincidental same-amount collision between two genuinely unrelated transactions (e.g. a round, common amount like 500€ showing up twice for unrelated reasons in the same week) would silently merge two unrelated things if this merged without confirmation — one tap is a small cost against that real risk.
- **No candidate found** → left as an ordinary transaction; matching runs again on every later save against the full pool of still-unmatched rows, not just same-session ones, so a partner entered or imported much later still gets suggested correctly whenever it eventually shows up.
- **More than one same-amount candidate found** → genuinely ambiguous, falls back to full manual selection exactly like today — no suggestion offered, since guessing between multiple candidates is worse than not guessing.

**No phone-only or tablet-only functions:** every function must be reachable from both devices — the difference is interaction *pattern* (grid vs. form), not *capability*. In practice most bulk categorization/review happens on tablet, but corrections must remain fully possible on phone.

**Confirmed column order (grid and phone-card layout alike):** Datum → Konto 1 → Konto 2 → Empfänger → Betrag → Kategorie → Unterkategorie → Details → Tags.
- **Konto 1 / Konto 2:** both accounts of a transaction are always visible as separate fields; Konto 2 shows a muted "—" when the transaction isn't a transfer (plain income/expense), rather than being hidden entirely. **Both are dropdown selects** (account picker from the `accounts` collection, §2.2), not free text — same interaction family as Kategorie/Unterkategorie, just without a cascading dependency between them.
- **Kategorie / Unterkategorie:** a cascading pair — selecting Kategorie (the parent group, e.g. "Lebenshaltung") filters which Unterkategorie options are offered (e.g. "Lebensmittel & Haushalt"). Only Unterkategorie is actually stored on the transaction line (§2.6); Kategorie is derived/display-only, shown for orientation and as the second half of the cascading picker. A transfer (both legs are accounts, no economic category) shows muted "—" in both.
- **Status (open/settled) is a visual indicator, not a column** — a small dot/icon placed on the **Unterkategorie value itself** (e.g. next to "Geld verliehen") for a line tied to an open claim/loan tag — not on the merchant/Empfänger text. The dot marks what's actually still outstanding, not the transaction that happens to be part of it. It's purely informational and fully derived: once a line carries a `claim`-type tag (§2.5/§3g — this now covers CPAM, Reisekosten, informal loans, and Amazon returns uniformly), the dot clears itself automatically the moment that tag's signed total nets to zero across every line and settlement transaction that carries it. The only manual action that ever touches this is Außenstände's close-out action (§3g), for the real case of a claim that never nets to exactly zero — reachable from Außenstände, not from Konten itself.
- **No "Aggregat" column:** a split transaction is shown as its parent row (with an expand chevron and an "N Positionen" hint) plus its detail rows revealed on expand — replacing the earlier two-column aggregate/detail idea (§2.1/§2.6 history) with an expand affordance, avoiding a column that's empty for the vast majority of rows.
- **No `reference` field:** considered and dropped — not something tracked day-to-day; `detail` (free text) covers what's actually needed.
- **Highlighting scope:** the yellow "needs attention" treatment is applied **only to the specific missing field** (e.g. just the empty Kategorie cell) — never a full-row wash. A dependent field that simply isn't available yet (Unterkategorie before Kategorie is chosen) gets a plain "blocked/disabled" look, visually distinct from an actual yellow missing-data flag, since it isn't itself the thing needing action.

**Konto1/Konto2 display rule (derived from `fromAccountId`/`toAccountId`, nothing new stored):** Konto1 always shows the transaction's primary real account — `fromAccountId` when present (an outflow: expense or transfer, shown negative), otherwise `toAccountId` (pure income, shown positive). Konto2 shows the second real account only when both are present (an actual transfer); otherwise muted "—". A **dedicated narrow column between Konto1 and Konto2** holds a bold, tinted directional arrow: pointing right (Konto1 → Konto2) when the amount is negative (money leaving Konto1), pointing left (Konto2 → Konto1) when positive (money arriving into Konto1 from Konto2) — populated only for actual transfers, blank for a plain income/expense row.

**Kategorie/Unterkategorie selection interaction:** both are dropdowns; Unterkategorie's option list is always filtered to whichever Kategorie is currently selected, and Unterkategorie cannot be opened/chosen until a Kategorie is set. **Changing Kategorie on a row that already has an Unterkategorie clears the Unterkategorie value** (rather than leaving a now-invalid choice in place) and flags it yellow/needs-attention until a new Unterkategorie is chosen from the freshly-filtered list — the same visual convention already used for missing categorization elsewhere in Konten.

**Reference mockup:** `mockup-konten.html` reflects this finalized column order and includes a live, working demo of the cascading Kategorie→Unterkategorie dropdown behavior (change Kategorie on the "Market Magasin" row to see Unterkategorie clear and flag itself), plus the arrow column, expand-affordance, and corrected status-dot placement described above.

**Pinned balance/consistency summary:** a permanently visible header above the ledger showing every account's current balance, grouped (Barkonten, Sparkonten, Unterkonten, Geldanlage, etc.) with subtotals — mirroring the existing Gsheet's row 1–9 dashboard. This is one of the most important pieces of the whole app: it's the daily reconciliation point against real bank balances on a given day, not just a nice-to-have overview. Internal consistency checks (e.g. Σ Unterkonten == parent Livret A) surface here.

**Raw bank label vs. user-facing label (new requirement, not possible in the old Gsheet):** every imported transaction must permanently retain its original, untouched bank CSV description. Auto-categorization or manual editing may attach a friendlier display label, but the raw label must never be overwritten or lost — it stays accessible from the transaction's detail view at any time.

**Multi-leg transfers (envelope → bank → investment chains) — resolved, no special handling needed:** a chain like a monthly Sparen Sophia contribution (BNP → Livret A → later → Livret A → BNP → Consors-Verrechnungskonto → Sparplan) is, in practice, just a sequence of ordinary single-hop transfers — each hop gets picked up by the transfer-matching mechanism above like any other transfer, one tap to confirm each. No additional grouping or "chain as one story" feature is wanted — confirmed not needed; the earlier open question here is closed.

**Loans / receivables — replaces the old "Verliehen" column entirely, and now closed the same way as any other Außenstände (§3g):** tracked structurally via the `receivable` account group + a `claim`-type grouping tag on both the lending line and the repayment line. Example: lending a friend money — tag the outflow with e.g. `Dirk Sept`; when repaid, tag that inflow with the same tag; the moment the two net to zero, the open-status dot clears itself. **No manual linking step exists** — the link-picker mechanism from an earlier pass of this spec is retired entirely, replaced by the same tag-based zero-sum closure used for CPAM, Reisekosten, and Amazon returns (§3g), rather than being its own separate mechanism.

**Tags — unlimited per line, not fixed at 2:** the old two-column Tag 1/Tag 2 habit was a spreadsheet limitation, not a real ceiling on need. In the new model, `tags: [<tagId>]` lives on each line (§2.6) — any number of tags per line (e.g. a trip tag plus a claim-category tag plus, in principle, anything else relevant), so a single split-off portion of a transaction can carry exactly the tags that apply to it without affecting the transaction's other lines.

**Visual "needs attention" flagging:** transactions missing a category (or otherwise incomplete) must be visually flagged (the Gsheet convention is yellow highlighting) so incomplete work is spottable at a glance, both on tablet and phone. This is the primary mechanism for finding the ~30% that auto-categorization missed.

**Split transactions — editing UX (the auto-remainder mechanism):** a transaction can consist of one lump sum that splits into several categorized/tagged lines (e.g. an Airbus salary deposit splitting into Gehalt / Steuern / Firmenwagen sub-lines; a grocery run splitting into a claimable portion and a personal portion). While splitting, the app **maintains a live, auto-generated "remaining amount" line** rather than requiring a manual balance check: creating a first sub-line (e.g. €8 of a €10 transaction) automatically leaves a second, system-maintained line for the other €2, which can either be categorized/tagged directly as the final line, or split further itself (creating a new remainder each time). This makes the split-transaction invariant (§2.6 — parent `amountCents` always equals `Σ lines[].amountCents`) true **by construction**, not by a validation warning caught after the fact — there is never a moment where the lines don't add up, because the remainder line is what absorbs the difference until the user is done. Displayed per §3a's confirmed pattern: the parent row with an expand chevron and an "N Positionen" hint, its lines revealed on expand (superseding an earlier two-column aggregate/detail layout idea — no separate "Aggregat" column).

**Editing:** simple edit-in-place, no audit trail/history needed (single user).

**Live consistency checks (replaces the audit-trail need with real-time correctness signals):** the app should surface warnings immediately when something looks wrong. Known checks so far:
- Allocation-tag reconciliation: Σ balance of sibling allocation tags must equal the balance of the account(s) they subdivide (e.g. Σ(Sparen Familie, Sparen Sophia, Sparen Julia, Rücklagen Steuern) == Livret A Sparen; Σ(Anlage Familie, Anlage Sophia) == Σ(Aktien, Crypto, Edelmetalle, ESOP); balance(Tagesgeld) == Livret A Tagesgeld) — see §2.5/§2.8.
- The two cross-cutting Barkonten/Rücklagen plan-vs-actual checks (§2.8a) should also surface here, since Konten's pinned header is one of the natural places for always-on reconciliation to live.
- (Old) sum of all outgoing = sum of all incoming — likely obsolete now that transactions are single documents with both legs baked in, but flagged to revisit.
- More checks to be defined as we go.

**Sorting/filtering/search — detailed spec:**
- **Live quick-filter search:** one text field, filters the grid live as the user types, matching across `displayLabel`/`rawDescription` (name/merchant), `note`/`detail` (comments), and `amountCents` (amount) simultaneously — one box, not one per field, per the user's own description of how they actually search ("I usually know some combination of these about the transaction I'm looking for"). Maps directly to AG Grid's built-in Quick Filter feature (§1b.1) — not custom-built, just enabled and wired to the right columns.
- **Per-field filters:** every column independently filterable (date, account, category, subcategory, tag "has this tag," status, etc.) via AG Grid's native column filters, restyled to match the app's visual language (§1b.4) rather than left in AG Grid's generic default appearance.
- **Single value per field, everywhere — a deliberate technical constraint, not an oversight:** AG Grid Community (the free tier, §1b.1) does not include multi-select checkbox filtering per column — that's an Enterprise-only feature with its own separate paid license. Since a category/subcategory filter only ever needs one value active at a time (confirmed), and nothing else described needs "show me BNP OR Paypal at once" within a single field, every filter in Konten stays single-value-per-field, keeping the whole feature on the free tier. Reaching for true multi-select within one field later is a real, deliberate cost/complexity decision to make explicitly, not something to fall into by building it by default.
- **Everything combines with AND:** quick-filter text + any number of active per-field filters + a date range, all simultaneously — exactly how the user described actually searching for a specific transaction (some mix of name, amount, account, category, all at once).
- **Date range — three quick presets plus a general custom range:** **Jahr** (defers to the existing global year selector, §1b.2a — not a separate control), **Monat**, and **Tag** as one-tap presets, with a fully custom start–end range as the underlying general case (a single day is simply a range where start == end, so one mechanism covers all four cases rather than four separate ones).
- **Saved, named filters:** any combination of the above (quick-filter text, per-field filters, date range) can be saved under a user-chosen name and recalled later from a list — confirmed as a genuine requirement, not ad-hoc-only. New collection, `savedFilters` (scoped to Konten for now; the same shape could extend to other grid screens later if it turns out to be wanted there too):
```
id, name
filterConfig: {
  quickFilterText: string | null,
  columnFilters: { [fieldName]: value },   // single value per field — accountId, categoryId, tagId ("has this tag"), status, etc.
  dateRange: { type: "year" | "month" | "day" | "custom", start: date, end: date }
}
createdAt
```
Applying a saved filter fully replaces the grid's current filter state (quick-filter text, per-field filters, and date range all set from the saved config at once) rather than merging with whatever's currently active — avoids a confusing partial-apply state.

---

## 3b. Verlauf (planning + actuals follow-up) — detailed spec

**Role:** while Konten is the single source of truth for what actually happened, Verlauf is the single source of truth for planning and monthly follow-up — how the user controls and steers spending toward a year-end outcome.

**Structure:** category/subcategory rows × month columns, grouped into four visual sections carried over from the Gsheet: account totals (computed), income, expenses, and savings/investment transfers (see §2.7 on why transfers are planned alongside expenses).

**Zero-value display:** a cell whose value is exactly 0 shows **empty, not "0"** — applies to every numeric cell in the grid (month columns and the Jahr column alike), across all three plan-line rows and breakdown rows. Keeps genuinely-zero months visually quiet rather than cluttering the grid with a wall of zeros, consistent with how sparse a lump-sum-funded category's month columns usually are (§3c's `yearly-rolling`/near-100%-einmal categories in particular).

**Three lines per category, always:**
- **Plan0** — set once a year, the fixed reference, protected by a soft confirm-to-edit lock (§2.7).
- **Plan1** — the adjusted working forecast; this is what the user actively manages through the year (unplanned spend, conscious reallocations between categories).
- **Actuals/Prognose** — a single row that is actually two different computations depending on whether a given month is "closed":
  - Past/closed months → **actuals**: `Σ transactions where categoryId == X and date in month` (pure Konten rollup).
  - Future/open months → **prognosis**: mirrors Plan1 for that month (i.e. "if nothing changes, this is what will happen").

**The month-close switch ("ok") is manual, not date-derived:** the user flips it consciously once a month's Konten data is fully entered and reconciled. If it flipped automatically on the calendar date, the prognosis/year-end prediction would be temporarily wrong for however long it takes to catch up on data entry. One switch per month, presumably a simple toggle per column.

**Breakdown lines** — see §2.7 for the full mechanism (grouping-class tags doubling as budget breakdown lines, with automatic Plan0/Plan1 sum-up and value-preserving migration when the first breakdown line is added to a previously flat category).

**Delta/explanation columns** (the old "Veränderung Prognose zu Plan1," "Mehreinnahmen/Mehrausgaben," etc.): fully computed, never manually entered. Confirmed sufficient as **annual figures only** (no monthly breakdown needed here) — these may end up relocated to a separate KPI dashboard rather than living inside Verlauf itself; decision deferred until dashboard/KPI work is discussed.

**Manual annotation (old free-text notes like "-226€ Reparatur Heizung teurer"):** mostly superseded by the breakdown-line mechanism — once a change is tied to a tagged breakdown line, the Plan0-vs-Plan1 delta for that line is computable automatically, removing the need to manually explain "what changed." Free-text notes remain available as a fallback for anything not worth breaking into its own tagged line.

**Not yet validated:** the tag-linked breakdown mechanism as designed is new (didn't exist in the Gsheet) — needs to be walked through against a few more real categories once the app is buildable, to confirm nothing about the old manual-annotation habit is lost. The parent-tag automated-rollup header (above) is newer still and carries the same caveat; its placement — **Plan1's breakdown block only, confirmed, not duplicated under Plan0** — is settled.

**UI layout (tablet vs. phone):** the grid uses **three real sticky columns**, matching the Gsheet exactly — **Kategorie** (the group, e.g. "Sonstiges" — spans, via rowspan, every row belonging to every subcategory within that group), **Unterkategorie** (e.g. "Urlaube" — spans only that subcategory's own rows: Prog, Plan1, Plan1's breakdown rows, Plan0, Plan0's breakdown rows), and a third column that combines **each row's own label with its yearly total** — either the plan-line name (Prog/Plan1/Plan0) or, for a breakdown row, that breakdown item's name — followed by the month columns. Breakdown item names live in this third column, never in Unterkategorie, exactly as in the source sheet. Each category's three data rows render in the order **Prog → Plan1 → Plan0** (top to bottom), Plan1's breakdown rows directly beneath Plan1, Plan0's beneath Plan0, each visually distinguished by smaller text and a tinted background (covering the full row including the Unterkategorie cell), with Plan0's breakdown rows additionally italicized to match Plan0's own styling.

**Rowspan must be dynamically recomputed, not static:** native HTML `rowspan` is a fixed number set once and does not shrink automatically when a row inside its span is hidden — unlike Google Sheets' merged cells, which resize based on currently-visible rows. The equivalent behavior in the app requires a small piece of logic that **recounts visible rows and reassigns the spanning cell's rowspan every time a row's visibility changes** (Plan0 toggled, a breakdown block expanded/collapsed, etc.) — a standard, well-understood technique, not a limitation of the platform. **Kategorie and Unterkategorie use the same font size** and are both vertically centered within their merged span. **Unterkategorie's column width is auto** (sized to its content), not a fixed/generous minimum — it was noticeably oversized in an earlier pass.

**Currency formatting rule:** the **Jahr (yearly total) column always carries the € sign**, on every row type (Prog/Plan1/Plan0 and breakdown lines alike); **every other numeric column (the twelve month columns) never does** — bare numbers only, consistent with the existing Gsheet convention and keeping the dense month grid visually lighter.

Two independent global controls sit in the header: **"Plan0 anzeigen/ausblenden"** (hides every Plan0 row at once) and **"Aufschlüsselung anzeigen/ausblenden"** (expands/collapses every breakdown block at once). **The expand/collapse arrow for a breakdown block sits on the Plan1 or Plan0 row itself** (not on the category/subcategory), and Plan1's and Plan0's breakdown visibility are controlled independently — collapsing Plan1's breakdown doesn't affect Plan0's, and vice versa. **Hiding Plan0 always hides its breakdown rows too**, regardless of that block's own expand/collapse state — a Plan0 breakdown row is only ever visible when both Plan0 is shown and that specific block is expanded. The month-close "ok" switches sit in their own header row, one per month, directly under the month labels. **Phone cannot meaningfully show 12 months at once**, so its layout inverts the axis: one month at a time (navigated with ‹ › arrows), all categories listed as compact cards for that month — the categories×months grid is a tablet-primary view, consistent with Verlauf being described as done "almost entirely on tablet."

**Reference mockup:** `mockup-verlauf.html` — tablet grid (three sticky columns with live, dynamically-recomputed rowspan; independent Plan1/Plan0 breakdown toggles; global show/hide controls) and phone's one-month card view, side by side, light/dark toggle included.

---

## 3c. Planung (annual budget sizing) — detailed spec

**Role — an annotated report, not an editing surface.** Planung enters **nothing** into the budget figures themselves — every category amount shown is a live mirror of Plan0/Plan1/Prog rows that already exist in Verlauf (§3b). All real planning — changing what a category is meant to cost — happens in Verlauf; change Plan0 there and it's immediately reflected here. Planung's only two genuine inputs are a **free-text comment per category per year** and the **regular/lump split**, and even the split is now fully automated (see below), so in practice the only thing the user actually *types* here is comments. Everything else is "plan on a page."

**Two year columns, driven by the global year selector (§1b.2a):** a **reference year** (always `selectedYear − 1`, always shown as that year's own Plan0 — closed years never change, so this column is permanently frozen once the year has passed) and the **planning year** (`selectedYear` itself), whose column defaults to **Plan0** but can be switched, per-view only, to show **Plan1** or **Prog** instead — a quick lens on how the plan has drifted through the year, not a different planning target. Switching that lens never changes what "the plan" actually is; comments and the split always attach to the year's **Plan0** row regardless of which version is currently displayed in the column.

**Structure — sections, top to bottom, matching the Gsheet:**
1. **Jahresanfang** — starting cash: `Alle Barkonten` at year start, minus the year's `minCashBufferCents` (§2.7a) — "the visible planning-start figure is real starting cash minus a hidden minimum buffer target," so planning always happens against "zero plus X," never accidentally into the buffer.
2. **Einnahmen** — income categories (Gehalt Markus/Julia, Sonderzahlungen, Kindergeld, Sonstige Einnahmen, etc.) — these are ordinary `categoryId`-linked budget rows (§2.7's `type: "expense"` covers any category-linked row regardless of sign, income included — no schema change needed, just noting the naming is a little misleading for this case).
3. **Fixkosten** — categories flagged `isFixkosten: true` (§2.4): Steuern, Krankenkasse, Hauskredit, Rente — fixed/uninfluenceable, not part of the discretionary planning loop.
4. **Budget summary band** — `Budget` (disposable income after Fixkosten), `Ausgaben vs. Budget` (the delta — "should be near zero, including Rücklagen"), and `... gebildete Rücklagen` (the savings-transfer portion of that delta, broken out) — all pure arithmetic over the sections above/below, nothing separately entered.
5. **Ausgaben** — every other category group (Wohnen, Kommunikation, Mobilität, Lebenshaltung, Gesundheit, Hobbys, Sonstiges), same grouping as Verlauf.
6. **Rücklagen** — the `type: "savings-transfer"` budget rows (Sparen Familie/Sophia/Julia, Anlage Familie/Sophia, Rücklagen Steuern, Tagesgeld) — still planned against the same disposable-income pool as ordinary expenses (§2.7), just targeting an allocation tag instead of a category.

**Regular/lump split — fully automated, no manual override for now:** for each budget row (income, expense, or savings-transfer alike — the split applies uniformly), the app computes it from the **reference year's closed monthly actuals** for that category/allocation tag: take the median of the 12 monthly values as the "recurring floor," `regulärJahr = median × 12`, `einmalJahr = jahresGesamt − regulärJahr`. This reproduces both patterns cleanly without any manual tuning — a near-constant monthly cost lands near 100% regulär, a category with mostly-zero months and one or two lump payments lands near 100% einmal — and matches the confirmed Nebenkosten example (≈223/month × 12 = 2.680 of 3.350 ≈ 80/20). `regularSharePercent` (§2.7c) stays in the schema as a **nullable override** — when null (the default, and the only path built for now), the app always computes it live via this formula; a future manual-override UI can simply write a non-null value later without any schema change. Formalized as a derived computation in §2.8.

**Comments:** one free-text note per (category, year) — reuses the existing `note` field (§2.7) already present on every budget row; no new field or collection needed, just newly exposed here as an editable box next to each year's figure.

**Prior-year comparison:** fully automated — the reference-year column is just that year's own closed Plan0 (or, further back, its own closed actuals), no copy/paste, no manual re-entry.

**Chart:** a grouped bar comparing the two years — for each year, one bar for **Budget** (green) paired against a stacked bar of **Ausgaben** (amber) + **Rücklagen** (purple), so a healthy year reads at a glance as "green taller than the rest." Confirmed exact formulas (checked against both years' real figures):
- `Budget = Einnahmen (Jahr) + Fixkosten (Jahr) + (Jahresanfang Barkonten − Puffer)` — i.e. **not** raw income; total spending capacity for the year (starting free cash, plus income, minus fixed costs) — 2025: 166.373 + (−67.716) + 5.687 = 104.344 ✓; 2026: 133.788 + (−83.346) + 14.240 = 64.682 ✓.
- **Ausgaben (amber portion)** = Σ every non-Fixkosten, non-Rücklagen category group (Wohnen, Kommunikation, Mobilität, Lebenshaltung, Gesundheit, Hobbys, Sonstiges).
- **Rücklagen (purple portion)** = Σ the `savings-transfer` budget rows (§2.7) — same six allocation-tag targets as everywhere else in this spec.
- Together, Ausgaben + Rücklagen is the "−97.000 €" grand total row that sits just above the per-group breakdown in the sheet, and `Budget − (Ausgaben + Rücklagen) = Ausgaben vs. Budget` (104.344 − 97.000 = 7.344 ✓), so the whole summary band (§3c structure, item 4) and this chart are the same numbers viewed two ways.

Colors reuse the app's own green/amber/purple semantics (confirmed fine). Orientation: horizontal bars, per your note about fitting the layout better than vertical.

**KPI row + Top 30 Ausgaben:** confirmed — these move to the Dashboard, not Planung (resolves the prior open item on where they'd live).

**Reference mockup:** `mockup-planung.html` — tablet report view (chart, section bands, comment icons, the 2026-column Plan0/Plan1/Prog source switcher) and phone's scrolling card view, side by side, light/dark toggle included. Populated with real figures from your Gsheet printout throughout, so the split percentages, subtotals, and chart proportions are the actual numbers, not placeholders.

---

## 3d. Prognose (year-end outcome + reconciliation) — detailed spec

**No separate screen — lives entirely inside Dashboard (§1b.2), confirmed.** What follows describes the three charts and reconciliation checks themselves; all three now surface as individual Dashboard cards, each opening its own detail view on tap, rather than one combined standalone "Prognose" page.

**Role:** the visual companion to Verlauf, showing Plan0 / Plan1 / Actuals-Prognose as one chart over the year, plus the two cross-cutting reconciliation checks (§2.8a) that catch drift between the planning side (Verlauf) and the ground truth (Konten). Entirely derived — no planning input happens in this view itself.

**Main chart:** Plan0, Plan1, and Actuals/Prognose lines for total account balance over the year, with Geldanlage and Sparkonten shown as supporting/background series for context (not the primary lines, but useful to see alongside the main cash trajectory).

**Top-right: yearly balance summary.** One line per `reportingGroup` plus overall total: `Jahresanfang` (start-of-year balance) → `+ Einnahmen` → `− Ausgaben` → `= Jahresende` (projected/actual end-of-year balance) → `Delta`. Shown for each of Plan0, Plan1, and Prognose in parallel, so the user can see at a glance how the year's three planning states compare. Fully computed.

**Bottom-right: fund-location chart.** For each allocation tag, which real/virtual account(s) actually hold its money and in what proportion (e.g. Anlage Familie: 94% in one account, 6% in another). Pure computation: `Σ balance(tag) grouped by contributing account`. No planning input.

**The reconciliation checks (§2.8a), applied here specifically:**
- **Barkonten check:** compares Verlauf's Prog line for the Barkonten reportingGroup against Konten's actual summed Barkonten balance, per month. A mismatch here is what the user currently reviews once a month; per §2.8a this is being elevated to always-on rather than Prognose-only.
- **Rücklagen check:** compares actual allocation-tag balances (Konten) against planned savings-transfer amounts (Verlauf), per month. Also being elevated to always-on.
- Both checks live naturally here as a monthly-grain, chart-backed view of the same underlying always-on reconciliation — Prognose is where you'd go to see the check's *history and trend* over the year, even once the check itself also surfaces live elsewhere (e.g. Konten's header).

**Supporting data table:** the month-by-month figures behind both the main chart and the two reconciliation checks — automatically generated from Verlauf + Konten, not separately maintained.

**Kontensicht cross-reference:** a full per-account monthly balance table (every individual account, not just the reportingGroup totals) sits alongside the Planungssicht table, letting the user drill from a group-level mismatch down to which specific account is off. This is effectively `balance(accountId, asOfDate)` (§2.8) tabulated for every account, every month — no new mechanism needed, just a comprehensive display of the existing computation.

---

## 3e. Quickview — detailed spec

**Role:** a pure past-transaction deep-dive — no plan, no Verlauf, no Budget/Prognose header, nothing computed or compared. Select a category (or breakdown/allocation tag — same unified selection as before), see what was actually spent against it, month by month, real Konten transactions only.

**Selection:** any single category, breakdown tag, or allocation tag — one unified lookup, exactly as before (§2.5's allocation tags and grouping tags behave identically here to a plain category selection).

**Per month, top 10 largest transactions, not the full list** — capped specifically to avoid one high-volume month (many small groceries runs, say) burying the view; sorted by amount, largest first. Not a hard ceiling on the underlying data, just what's shown by default — a link/action to see everything for that month (e.g. jump to Konten pre-filtered by category + month) covers the rest, same "don't hide data, just don't force-render all of it" spirit as everywhere else in this spec.

**Only months that have actually occurred are shown; future months are hidden entirely, not rendered empty.** "Occurred" here means real elapsed calendar time, not Verlauf's ok-switch pivot (§3b) — Quickview has no dependency on Verlauf's closing workflow at all now, unlike Fortschritt (§3j) below, which does.

**Line-item format, unchanged:** `displayLabel` plus `detail` in parentheses when present (§2.6).

**Time granularity:** always the current year (via the global year selector, §1b.2a); no quarter/custom-range mode needed.

---

---

## 3f. Status ("where am I") — detailed spec

**No separate screen — lives entirely inside Dashboard (§1b.2), confirmed.** The Dashboard card shows a selection only (the most-deviating categories); everything described below is the full list, reached by tapping that card into its detail view.

**Role:** at-a-glance visual pacing check — for every category (and income line), is actual spend/income tracking ahead of, behind, or on pace with plan, normalized to a 12-month bar. Answers "where am I right now" without opening Verlauf.

**Layout:** a single bar list sorted by annual **Plan1 total, most negative to most positive** — not two separately-ordered expense/income lists. This means a category's side (appearing among the "expenses" or the "income") is simply where its signed Plan1 total falls in that one sort, and it can shift sides year to year automatically if its net flips sign (e.g. Firmenwagen nets positive some years due to reimbursements exceeding cost, despite living in a normally-expense category group) — no manual category-side assignment needed. A **filter control** lets the user restrict the view to negative-only, positive-only, or all categories. One bar per **category** — breakdown lines (e.g. Schottland Unterkünfte under Urlaube) don't get their own bar; the category is the unit of display here.

**Bar geometry (confirmed from a live screenshot):** the vertical axis is literally month-of-year (0–12), not a currency scale — each bar's height represents *pace*, not amount. Dark (blue for expense-side, green for income-side) = spent/received so far; light = remaining budget headroom (light blue = Budget, light green = Zieleinnahmen); a **red segment stacks on top of the bar** once actual spend passes the planned cumulative line — the overspend amount specifically, not a full-bar color swap; the bar's normal blue/green coloring stays underneath it. A dashed horizontal line marks the current calendar/ok month across all bars; a black dot per bar marks the "budget month" — i.e. which month's cumulative plan level the actual figure corresponds to. Currency figures (annual Budget/Prognose totals) are printed as labels on/above each bar, not part of the geometry itself.

**Dotted "current month" marker:** positioned by Verlauf's manual "ok" switch (§3b) — the same switch that governs everything else that depends on "is this month closed," not the calendar date. Moving the switch moves this marker everywhere at once.

**Two pacing modes, chosen deliberately per category during planning (not inferred from the shape of the numbers):**
- **`fixed-profile`** (Lebensmittel-style constant, or Garten-style seasonal shape): cumulative planned amount through the current month (using each month's actual Plan1 value, flat or shaped) vs. cumulative actual. Dot shows where cumulative actual sits against that cumulative plan line.
- **`yearly-rolling`** (Klamotten-style): no fixed monthly figure — remaining monthly allowance recalculated live as `(yearly Plan1 total − actual-to-date) / remaining months`. The dot always sits at the top of the dark (spent) portion of the bar; the light portion shows what's left to reallocate across remaining months.
- This choice (`pacingMode`, §2.7c) is made once during planning, same lifecycle as `regularSharePercent` — set alongside Plan1, not re-derived automatically, and applies identically to income lines (a lump-sum-style income category could in principle use `yearly-rolling` too, though `fixed-profile` is the expected default there).

**Overspend indication:** the bar simply turns red the instant actual spend exceeds the planned cumulative line for that point in the year — no separate flag or threshold banner. A trivial cent-level overshoot just shows as a very thin red sliver, which is self-evidently a non-issue at a glance; no tolerance band needed.

---

## 3g. Außenstände (open claims & loans) — detailed spec

**Role:** a single, generalized tracker for anything with money temporarily out and expected to come back — Airbus travel-expense claims, CPAM health-cost claims (on hold, §4), informal loans to/from friends and family, and the reimbursement side of Amazon returns — all the same mechanism, differing only in which receivable account and which (if any) claim-category tags are involved. What started as a Reisekosten/CPAM-specific design generalizes cleanly: every one of these is "tag the outflow, tag the eventual inflow the same way, watch for the two to net to zero."

**Built entirely on the existing receivable + tag mechanism (§2.2, §2.5, §2.6) — no new collection, no new field.** A claim/loan is a `grouping`-class tag with `groupingType: "claim"` (freeform name — `2026-03 GET`, `2026-06 HAM`, CPAM's `GW1298747`, or an informal loan's own label like `Dirk Sept`), applied to every relevant line: every individual expense line (meals, taxis, hotels — paid from any account, including cash accounts, since claims aren't card-only), the loan's original outflow, and the eventual settlement/repayment transaction from the `receivable` account back into a real cash account. Every side carries the same tag; the tag's net (Σ signed amounts across every line and transaction carrying it) is exactly zero once fully settled.

**Claim-category tags, where relevant, are a second tag on the same line — not a separate field.** For Airbus specifically: while tagging a transaction line with the trip tag, the category picker (Meal/Team Meal/Taxi/Hotel/…) becomes available as a second `claim-category`-type tag on that same line (§2.5) — freely created inline like any other tag, offered only once a `claim`-type tag is already present. This is where Reisekosten becomes almost entirely a **display/query screen**: pick a trip tag → every line carrying it, grouped visually by whichever claim-category tag it also carries → **line items are never summed within a group** (three separately-tagged "Meal" lines display as three lines, matching the source Gsheet's habit exactly) → the trip's net total. A loan or a CPAM claim has no claim-category tags at all — those screens are the same query, just without that grouping layer, and CPAM would instead rely on its existing freeform `note` field per line (§2.6) for its own quick-info habit ("Apotheke," "Dr. Morin"), not a category tag.

**No manual status field anywhere.** `claimStatus` was considered and dropped — the only thing actually needed is the net-zero indicator, computed live per tag (§2.8a extends here: same "flag the instant something doesn't balance" principle, scoped to one tag instead of a reportingGroup or allocation-tag set), and Konten's open/settled dot (§3a) is exactly this same computed value, surfaced at the line level. The tag mechanism closes a claim by itself whenever the two sides genuinely do net to zero — see the close-out action below for the case where they don't.

**Close-out action — for the real case where a claim never nets to zero exactly (caught in external review, Sept 2026).** A CPAM reimbursement rarely matches the original cost exactly; Amazon deducts return shipping or a restocking fee; a friend might repay €95 of a €100 loan and call it settled. As specced above, none of these would ever clear — the tag would sit at a small non-zero residual forever, the status dot would never clear, and Außenstände would show a permanently "open" item that's actually done. **The fix is one manual action, available from the Außenstände screen on any open claim: "close out."** It creates a settlement transaction moving the residual amount from the `receivable` account to a real spending category (Markus picks it, same as any other categorization), carrying the same claim tag. That both nets the tag to exactly zero — clearing the status dot the normal, computed way — and correctly books the shortfall as a real, categorized expense rather than leaving it invisible. This is a genuine exception to "nothing about a claim's progress is typed in by hand" above: closing out a partial settlement is the one deliberate manual step in an otherwise fully automatic mechanism.

**One line per real transaction, always — no claim-only line items.** Every line appearing under a claim/loan tag traces back to a real Konten transaction (even cash-paid items go through the Bar-account ledger); a single transaction line can only carry one claim tag at a time (per line, not per transaction — a split transaction can have one sub-line tagged for a claim and another not, e.g. the claimable vs. personal portion of one grocery run, §2.6/§3a). This keeps "the tag's net total" and "sum of tagged Konten lines" mechanically identical by construction, not just by convention.

**The Außenstände screen itself:** every open (non-zero) `claim`-type tag, across every receivable account, surfaced together — open ones first, settled ones available but out of the way. Selecting one shows its lines (grouped by claim-category tag when present) and its net-zero status. This single screen replaces what would otherwise have been three or four separate trackers (Reisekosten, CPAM, loans, Amazon returns) with one general-purpose one.

**Amazon returns are covered by this same mechanism at the reimbursement level** — tag the returned item(s) and the refund the same way, net-zero closes the loop exactly like any other claim. **What's explicitly not covered, and stays separately parked (§4):** categorizing and annotating the *individual items inside one Amazon order* (e.g. a single €100 charge that's actually Garten + Lebensmittel + Hobbys) for ordinary bookkeeping purposes, unrelated to returns — today done by manually splitting the order line and annotating each sub-line, kept under the single "Amazon" label since there's no clean way to extract itemized order data from Amazon. A different, harder problem (no clean source data to work from), left for a later pass.

**CPAM remains on hold** (§4) — the mechanism above is now confirmed to apply directly once picked back up, with no separate design expected; CPAM simply won't use claim-category tags, relying on `note` instead.

**Reference mockup:** `mockup-aussenstaende.html` — tablet and phone list/expand view. Populated with your real 2026-03 GET (settled, 8 lines across Team Meal/Meal/Taxi), 2026-04 HAM (settled, 2 lines), and 2026-05 HAM (open, −336,50 € outstanding) trip data, plus an informal-loan and an Amazon-return example to show the same screen handling every Außenstände type without special-casing.

---

## 3h. Monatsabschluss (monthly close checklist) — detailed spec

**Role:** a monthly workflow screen replacing the Gsheet's Check tab — walk through the same three phases (Daten → Verfeinerung → Abschluss) each month, with the checkbox grid persisted per month exactly as today (so which months are fully closed out stays visible at a glance across the year). What changes is *what a checked box means*.

**Every item is one of two kinds, and the distinction is the whole point of moving this into the app:**
- **Auto-derived items** — bound to a live check the app can already compute (§2.8a's Barkonten/Rücklagen checks, allocation-tag reconciliation, Verlauf's per-month ok-switches, Außenstände's net-zero indicators, import-completeness where determinable). These show ✓/⚠ **automatically**, live, and are never manually ticked — the checklist just reflects the app's own state. Tapping a ⚠ item jumps straight to wherever the underlying problem actually lives (Konten, Verlauf, Außenstände…) rather than leaving the user to go hunting.
- **Manual items** — real to-dos with no underlying data signal to derive from: per-account review passes ("looked at DKB, it's fine" — confirmed still needed, since several accounts are manually entered with no CSV export and no automatable "did I check this" signal), category-assignment sweeps, actual outgoing transfers ("Überweisungen"), and similar. These stay plain checkboxes, ticked by hand, exactly as today.

**Mapping your current list (illustrative, confirmed automatic-where-possible per your answer):**
- **Daten section** (BNP Giro, DKB, Paypal, Visa Airbus, Consors/Smartbroker/Coinbase Verrechnungskonto, ANCV Chèques Vacances, Notizen, Bar) — **all manual**, per-account "I looked at it" passes, confirmed still needed regardless of CSV availability.
- **Verfeinerung section** ("Assign all categories," "AIRBUS Gehalt," "Amazon," "AIRBUS Reisekosten," "CPAM," "Außenstände") — mixed: the categorization sweep itself is manual work; but "AIRBUS Reisekosten"/"CPAM"/"Außenstände" as *checks* are exactly what the Außenstände screen's net-zero indicators already compute — so those three become auto-derived (jump straight to any open item), while the underlying categorization work stays manual.
- **Abschluss section** ("Fehlermeldungen," "Verlauf checken," "Consors Verrechnungskonto ausgeglichen?") — **auto-derived**, direct reflections of existing live checks. "Urlaub," "Sonderausgaben," "Investitionen Haus," "Rücklagen," "Steuern," "Geldanlage," "Überweisungen" read as further manual review/action passes — same treatment as the Daten section's per-account items unless you tell me otherwise.

**Editable template:** the checklist itself (which items exist, which are auto vs. manual, their grouping/order) lives in Settings, same spirit as the category-editability item already logged (§4) — your workflow will keep evolving, and the list shouldn't need a code change to change.

**One open question, not yet resolved:** the exact binding for a few ambiguous items above (per-account "did I check this," the Abschluss-section review items) — I've proposed a reasonable default for each, but since several genuinely could go either way, I'll treat these as placeholders to refine once the screen is actually mocked up and you can react to a concrete first pass, rather than guessing further in the abstract.

**Reference mockup:** `mockup-monatsabschluss.html` — tablet 12-month grid (auto items as a live ✓/⚠ icon, manual items as real checkboxes, current month highlighted, future months disabled) and phone's single-month list view. A deliberately planted June warning on "Consors Verrechnungskonto ausgeglichen?" demonstrates that even a past, otherwise-closed month can resurface a problem.

---

## 3i. Settings (Einstellungen) — detailed spec

**Role:** where the app's structure itself gets edited — categories, accounts, tags, and the few per-year/workflow settings already mentioned elsewhere in this spec but not yet drawn together in one place. This section exists because of one real, previously-parked problem (§4): **the category/account list must stay editable indefinitely without breaking historical data** — Markus needs to add or remove categories as needs evolve, years after the app is first used, and nothing from a prior year should ever become unreadable or silently wrong because of a later structural change.

**The core mechanism, applied uniformly to categories, accounts, and tags alike — two operations, not three:**

1. **Rename** — trivial, always safe, no special handling needed. `id` never changes, only `name`; every historical reference (a transaction's `categoryId`, a budget row, a tag on a line) resolves through the id, so a rename is instantly and correctly reflected everywhere, past and present, with nothing to migrate. This is true today for categories and accounts, and already explicitly true for tags (§2.5's Tag-management screen).

2. **Archive, not delete, the moment there's any history to protect** — an archived category/account/tag disappears from every picker and autocomplete used for *new* entries, but every existing reference to it (a two-year-old transaction, a closed year's Plan0 row) keeps rendering exactly as it always did — same name, same group, same numbers. **A true hard delete is only offered when nothing has ever referenced the item** (a category created by mistake five minutes ago, never used) — Settings shows a live count before either action, so there's no guessing whether archiving vs. deleting is even available. This count covers every *kind* of reference, not just the obvious ones — for a category: `"47 Transaktionen, 6 Budgetzeilen verwenden diese Kategorie"`; for an account, that same transaction/budget count **plus** a check against every allocation tag's `reconciliationTargetAccountIds` (§2.5) — an account like Livret A Sparen can be structurally load-bearing for Sparen Familie/Sophia/Julia while having few or no transactions directly against it, so a reference count that only looked at transactions and budget lines could miss it and let the account get archived/deleted out from under a still-active tag. This mirrors §2.5's tag-archiving pattern exactly, now extended to categories and accounts, which never had it explicitly stated before.

**Merge — cut, not built (external review, Sept 2026).** Was specced as a third operation (fold two categories/tags into one, reassigning every referencing transaction/budget line). Confirmed genuinely never used in practice for categories, and correctly flagged as disproportionate risk for what it's worth: a batch rewrite across collections, with no undo and no audit trail — a materially bigger risk than rename or archive, neither of which touches other documents at all. Rename and archive already carry most of the real value at a fraction of that risk. Left unbuilt until an actual duplicate shows up that genuinely can't be lived with any other way (§4's parked ideas).

**Restructuring — moving a subcategory to a different group (e.g. "Ausgehen" from Lebenshaltung to Sonstiges) — resolved: live/instant, no versioning (Option A).** A category's `parentCategoryId` (§2.4) is just a current property with no history of its own — the moment it changes, *every* view, including past closed years in Planung and Verlauf, reports the subcategory under its new group from then on. This keeps the whole data model in one consistent shape (nothing else here is year-versioned) at the accepted cost that a restructure done today can shift how a past year's group total reads when compared later, even though nothing about that year's actual spending changed.

**What lives in Settings, concretely:**
- **Kategorien** — the full tree (§2.4): add/rename/archive/move-to-another-group per the mechanism above; toggle `isFixkosten` per category (currently Steuern/Krankenkasse/Hauskredit/Rente).
- **Konten** — the accounts list (§2.2): add/rename/archive per the same mechanism; `group` and `reportingGroup` assignment.
- **Tags** — the existing Tag-management screen (§2.5): rename/archive for any tag, allocation-tag reconciliation-target setup.
- **Jahres-Einstellungen** — per-year settings currently limited to `minCashBufferCents` (§2.7a), entered inline in Planung today (§3c) but conceptually belongs here too; no change to where it's entered, just noting it's part of the same "structural settings" family.
- **Monatsabschluss-Vorlage** — the checklist template (§3h): which items exist, their grouping/order, and which are auto-derived vs. manual.

**Not covered here, deliberately:** Import/Export stays its own separate nav item (§1b.2), since it's a data-movement workflow rather than a structural-editing one — different enough in kind that folding it into Settings would blur two distinct jobs.

---

## 3j. Fortschritt (booked vs. still planned) — detailed spec

**Role:** a genuinely different tool from Quickview (§3e), not a variant of it — the two were briefly, incorrectly merged before being split back apart. Shows any category/subcategory split cleanly into **what's already real** and **what's still only planned**, divided at exactly the point Verlauf itself says is closed. Fully generalized: works identically for a flat subcategory with no tag structure underneath it (`Lebensmittel & Haushalt`) and one with several (`Urlaube`, which might have `Schottland`, `Norwegen`, etc. all sitting underneath it at once), auto-adapting to whatever level of detail actually exists rather than requiring any particular structure.

**Selection — a plain two-step picker, not a unified lookup:** **Kategorie**, then **Unterkategorie** — the same two fields as everywhere else in the app (§2.4), nothing more exotic. No tag-picker: which tags show up is discovered automatically from whatever's actually tagged within the selected subcategory, not chosen by the user.
- If the selected subcategory has **no tagged breakdown structure** underneath it (groceries, most ordinary subcategories): one flat card — Bereits gebucht / Noch geplant for the subcategory as a whole, no grouping layer.
- If it has **one or more tags** underneath it (`Urlaube` might have several trips tagged within it simultaneously — `Schottland`, `Norwegen`, whatever exists that year): one card per tag found, each independently split into Bereits gebucht / Noch geplant. Tablet shows the cards side by side; phone stacks them.
- **Allocation tags are explicitly out of scope for this screen** (Sparen Familie/Sophia/Julia, Rücklagen Steuern, Anlage Familie/Sophia, Tagesgeld, §2.5) — conceptually closer to sub-accounts than to spending progress, the same reason real accounts don't get a Fortschritt view either. Not reachable from this screen's selector at all.

**Header figures (per card):** `Budget` = Plan1 total for that card's selection (year), `Prognose` = Prog total for that card's selection (year) — pulled directly from the existing Verlauf/`budgets` numbers, nothing separately computed.

**Split at the pivot — the last month ticked "ok" in Verlauf, a single global value the app already tracks (§3b), nothing separately maintained here:**
- **Bereits gebucht** (≤ pivot month): every real Konten transaction matching that card's selection, listed individually — `displayLabel` plus `detail` in parentheses when present, same line-item format as Quickview.
- **Noch geplant** (> pivot month): that card's remaining Plan1 values, one line per remaining month — what's still budgeted but not yet real.
- **Nothing is reconciled or netted between the two sections** — a month that closed with less spent than planned just shows less in "Bereits gebucht" for that month; moving the unspent remainder into a later month's Plan1 stays a manual action in Verlauf, same as always (§3b/§3c). This view is a query, not a rebalancing tool.
- A small discrepancy between what was tagged and what a rounder Plan1 number assumed is expected and normal (planning is intentionally not cent-precise) — not a reconciliation-check candidate, just two honestly different numbers sitting next to each other.

**Working name only** — "Fortschritt" is a placeholder, not a final UI label.

**Reference mockup:** `mockup-fortschritt.html` — tablet and phone. Demonstrates the mechanism with `Urlaube` → `Schottland` as the one tag present that year, reusing the exact figures from the Verlauf mockup's "Schottland (automatisch)" row (Budget −6.840 €, Prognose −6.791 €) for direct cross-consistency; Bereits gebucht shows July's three real bookings, Noch geplant shows August/September's remaining Plan1 lines. **Still needs updating** to actually show the Kategorie/Unterkategorie selector at the top of the screen (not yet built into the mockup) — no need to additionally mock out other child-counts (0, 3+ tags at once, etc.); the grouped-vs-flat rendering is already proven elsewhere in the app (Verlauf's breakdown blocks, Außenstände's claim grouping), so nothing new there needs visual de-risking.


---

## 3k. Import/Export — detailed spec

**Scope note:** *Import* is already fully specified — it's the CSV bank-import pipeline living inside Konten (§3a), not a separate mechanism. This section covers **Export only**, which had a nav slot reserved since early on (§1b.2) but was never actually designed.

**Purpose — disaster recovery only, nothing else.** Not a re-import-elsewhere format, not an analysis/reporting export, not something aimed at opening in another tool day-to-day. The only job this serves: if Firebase itself is ever lost, corrupted, or needs to be rebuilt, this is what makes the data recoverable rather than gone. That single purpose is what decides every format choice below — faithful and complete beats convenient or pretty.

**Two exports, both reachable from the same screen:**

1. **Transactions CSV** — every transaction, structured so both the parent transaction and its split children are captured without double-counting when the amount column is summed:
   - **One parent row per transaction, always.** Columns: `Datum`, `Konto1`, `Konto2`, `RohBeschreibung` (rawDescription), `Empfänger` (displayLabel), `TransaktionsBetrag` (the parent's total), `PositionsBetrag` (blank on this row unless the transaction has only one line — see below), `Kategorie`, `Unterkategorie`, `Tags`, `Kommentar`, `Status`, `ZeilenTyp` = `Transaktion`.
   - **If the transaction has more than one line (a real split): one additional child row per line**, directly below its parent row. Same columns, but `TransaktionsBetrag` is left **blank** (it already appeared once, on the parent row — repeating it on every child row is exactly the double-counting risk being avoided) and `PositionsBetrag` carries that line's own amount instead. `Kategorie`/`Unterkategorie`/`Tags`/`Kommentar` on a child row reflect that specific line (`categoryId`/`tags`/`note` from §2.6); `ZeilenTyp` = `Position`. Multiple tags on one line join into a single cell with a `|` separator.
   - **If the transaction has only one line (the ordinary, non-split case — the large majority):** no separate child row — the parent row already carries that single line's `Kategorie`/`Unterkategorie`/`Tags`/`Kommentar` directly, and `PositionsBetrag` on that same row equals `TransaktionsBetrag` (the one and only line's amount, same number, just also visible in the position column since there's nothing to distinguish it from). This avoids doubling the row count for the vast majority of transactions that were never split in the first place.
   - **Net effect:** summing the `PositionsBetrag` column alone, across every row, always equals the true total spend — no need to filter out parent rows first, since a parent row's `TransaktionsBetrag` is never the thing being summed for that purpose. `TransaktionsBetrag` exists purely as a per-transaction reference/integrity check (does the parent's stored total still match the sum of its own children's `PositionsBetrag` rows?), not a value meant to be aggregated across the whole file.
   - `Kommentar` maps to the transaction-level `detail` field on a parent row, and to that line's own `note` field on a child row (§2.6) — same column, contextually disambiguated by `ZeilenTyp`.

2. **Full dataset export (JSON)** — every collection actually authored by hand: `transactions`, `categories`, `tags`, `accounts`, `budgets`, `settings`, `categorizationRules` (§2.7b), `savedFilters` (§3a) — the last two were missing from this list until caught in external review (Sept 2026); both are real accumulated data (learned keyword rules, named filter presets), not derived, and a backup that lost them silently would be an incomplete backup. Raw Firestore-shaped JSON, one file per collection (or one combined file — implementation detail, not a design decision). **Deliberately excludes** everything in §2.8 (derived/computed, never stored) — Verlauf's Prog rollups, Status's pacing figures, any live reconciliation check result — since none of that is data to protect in the first place; it's recomputed from the collections above every time the app runs, so backing it up would be redundant, not protective. If the collections above are intact, everything derived reconstructs itself automatically the moment the app runs again.

**Not built here:** any scheduling/automation (e.g. a recurring nightly export) — this is a manual, on-demand action for now; automating it is a possible future addition, not part of this spec.

---

## 4. Open questions log

(Running list of things flagged as "to be discussed" above, so nothing gets lost:)
- Full subcategory list per category group — **resolved (§2.4): transcribed from the Gsheet's reference tab.** One follow-up spotted in the transcription: a possible 7th allocation tag, "Tagesgeld" — flagged inline in §2.4, needs your confirmation.
- CPAM / travel expense claim grouping mechanism (individual bookings → one lump-sum claim) — **resolved (§3g): generalized into Außenstände, same mechanism as Reisekosten/loans/Amazon returns.**
- Planung mechanism: category budget type (monthly-funded / yearly-lump-funded / split) and how that's modeled — **resolved (§3c, §2.8): fully automated median-based split, no manual override built for now.**
- Multi-year data model / global year selector — **resolved (§1b.2a): single global selector in the shell header, drives Konten/Verlauf/Planung/Prognose/Status/Quickview, defaults to current year.**
- Planung's Top 30 Ausgaben / KPI row placement — **resolved: Dashboard (§3c).**
- Planung: whether a comment always attaches to the year's Plan0 row regardless of which version (Plan0/Plan1/Prog) is currently displayed in that column, or should follow whichever version is on screen — **resolved: comment always stays with Plan0, unaffected by which version is currently displayed (§3c).**
- Status view's "normalized to 12 months" spend-pacing logic — **resolved (§3f): `pacingMode` field, `fixed-profile` vs. `yearly-rolling`, set once during planning.**
- Graphs: which ones, what they show — **resolved:** every graph in the spec is now accounted for — Planung's Budget-vs-Ausgaben bars (§3c), Prognose's year-progression + yearly-summary + fund-location charts (§3d), Status's pacing bars (§3f), and Dashboard's consolidated hero chart (§3i-equivalent, in the Dashboard section).
- Konten: phone split-transaction expand/collapse pattern — needs real-device validation once buildable.
- Konten: whether to add explicit visual/logical grouping across a multi-leg transfer chain (allocation tag → bank → investment), beyond the two-line linking each individual leg already gets.
- Verlauf: tag-linked breakdown-line mechanism needs validation against more real categories once buildable.
- Verlauf: whether the delta/explanation columns (Veränderung, Mehreinnahmen, etc.) live in Verlauf itself or move to a future KPI dashboard — **resolved: Dashboard, alongside Top 30 Ausgaben (see above).**
- Planung/Verlauf: where the "Top 30 Ausgaben" list and income-vs-expenses-vs-savings graph ultimately live (Planung, Verlauf, or a separate dashboard) — **resolved: Dashboard (duplicate of the item above, kept for history).**
- Confirm "Livret A Sparen"/"Livret A Famille" naming merge (§2.2) is correct — treated as the same account throughout this doc from this point on.
- UI placement of the two always-on reconciliation checks (§2.8a) — **resolved: surfaced in three places now — Dashboard's alerts band (top-level visibility), Monatsabschluss's auto-derived checklist items (§3h, monthly workflow context), and Konten's per-line status dot (§3a, in-context while working).**
- CPAM's specific quick-info habit (Apotheke/Dr. Brunon/etc.) is confirmed to use the existing freeform `note` field (§2.6), not a claim-category tag — no enum to transcribe, since CPAM doesn't use that mechanism at all. §3g's generalized Außenstände mechanism otherwise applies directly once CPAM is picked back up.
- Deepdive — parked, low current usage; revisit only if it turns out to be needed later.

### Parked feature ideas (noted, not yet designed)
- **Amazon: intra-order item categorization**, distinct from Amazon *returns* (which §3g's Außenstände mechanism now fully covers) — the unsolved part is breaking down one €100 Amazon order into its actual Garten/Lebensmittel/Hobbys categories for ordinary bookkeeping, with no clean way to extract itemized order data from Amazon to work from. Genuinely harder problem (no source data), left for a later pass.
(Settings/category-editability — **resolved: §3i**, moved out of parked status now that the per-screen UI pass is complete.)
- **Gehaltsabrechnungen** (payslips) — noted as an idea, nothing designed. May never actually get built.
- **Geldanlage** (investments) — noted as an idea, beyond what §2.2's `investment-tracking` accounts and §2.7a's cost-basis-only approach already cover. May never actually get built.
- **Merge** (categories/tags) — cut from §3i on external review (Sept 2026): a batch rewrite across collections with no undo and no audit trail, for a case that's never actually come up in practice for categories and only occasionally for tags. Build only if an actual duplicate shows up that genuinely can't be lived with via rename/archive alone.
