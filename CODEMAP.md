# CODEMAP.md

A short structural map of the actual codebase — not what the app is (`spec.md`), not the build order (`PLAN.md`), not what happened (`DEVLOG.md`): where things physically live. Updated on real structural change (a new major component, a folder reorganization, a new shared module), not every session — same discipline as `spec.md`, not a diary.

Added on external review, Sept 2026: without this, every session re-derives the codebase's shape by reading around it, and across many sessions that's how two components quietly end up doing the same job.

---

## Top-level structure

React + Vite app, plain JavaScript (no TypeScript — not asked for, and Markus never reads the code directly). Built with `npm run build` into `dist/` (gitignored), deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

- `index.html` — Vite entry HTML; loads `src/main.jsx`.
- `vite.config.js` — React plugin, Tailwind v4 (`@tailwindcss/vite`), and `vite-plugin-pwa` (see below). `base: '/Geld/'` because the app is served from a GitHub Pages project site, not its own domain.
- `src/main.jsx` — app entry point; registers the service worker (`virtual:pwa-register`) and mounts `<App />`.
- `src/App.jsx` — currently the *entire* app: sign-in/sign-out and the blank authenticated shell (Phase 0's deliverable). Real screens will replace this as they're built — nothing here yet decomposes into per-screen components.
- `src/firebase.js` — Firebase `app`/`auth`/`db` initialization. Firestore is initialized with `persistentLocalCache` + `persistentMultipleTabManager` (spec.md §1a's "offline cache is the real data store, not a bolt-on").
- `src/firebaseConfig.js` — the public Firebase project config object (not secret, safe to commit — see the comment in the file).
- `src/lib/authReady.js` — `waitForInitialAuthState()`, the bounded (4s) timeout around Firebase Auth's own init calls (spec.md §1a's cold-start-stall mitigation). Any future code that needs "is there a signed-in user yet" at startup should use this rather than reading `auth.currentUser` directly or assuming `onAuthStateChanged` fires promptly.
- `src/sw.js` — hand-written service worker source, built via `vite-plugin-pwa`'s `injectManifest` strategy (**not** `generateSW`, which is the default and does *not* give network-first navigation — a real footgun already hit once during Phase 0: the option is `strategies` (plural), and a `strategy` typo silently falls back to `generateSW` with no error). Implements: precache-and-route from the real build manifest, and a `NavigationRoute` wrapped in `NetworkFirst` (2.5s timeout, `app-shell` cache) so navigation never serves a stale cached shell while online (spec.md §1a).
- `src/index.css` — Tailwind import, the semantic color tokens from spec.md §1b.4 (as CSS custom properties, light + `prefers-color-scheme: dark`; manual override switch not built yet — lands with the Settings screen), self-hosted Inter/JetBrains Mono via `@fontsource/*` (not a Google Fonts CDN link — offline-first means no runtime dependency on a third-party host for something as basic as page text), and the `overscroll-behavior: none` / `touch-action: pan-y` fix from spec.md §1.
- `public/icons/` — placeholder PWA icons (flat-color circle mark, programmatically generated, not a real design) — swap these out whenever real icon design happens; nothing depends on their current appearance.
- `firebase.json` / `.firebaserc` / `firestore.rules` / `firestore.indexes.json` — Firestore-only Firebase config (no `hosting` key — GitHub Pages serves the app, not Firebase Hosting, per spec.md §1b.1). `firestore.rules` is currently deny-all (`allow read, write: if false`) until Markus's admin UID is known and the single-admin rule replaces it (§1a/§1b.1).

### `migration/` — one-off 2025 + 2026 import from the Gsheets (PLAN.md Phase 1a)

Not part of the app bundle. Python scripts that turn Markus's yearly "Geld 2025" / "Geld 2026" Google Sheets into Firestore-shaped JSON, each with built-in checks against the sheet's own totals that fail loudly on any mismatch.

- `migration/seed/` — **committed**, non-personal static data transcribed from spec.md: `accounts.json` (§2.2), `categories.json` (§2.4), `tags-allocation.json` (the 7 allocation tags, §2.5).
- `migration/transform-transactions.py [year]` — `Konten` tab → that year's transactions; for 2025 also the one-time Jahresabschluß opening balances. Later years skip their sheet's own opening rows and are checked against the full history (Jahresabschluß + every year so far), so the later sheet's header must come out of the app's own carry-over; known carry-over differences are either booked (`CARRYOVER_CORRECTIONS`) or explained by an earlier-year `CORRECTIONS` entry. Core rule, verified against the sheet: every row changes only its own Konto (`Σ Teilwert per Konto` is the sheet's header formula; `Wert` never counts); transfers appear as two rows and are paired globally, unpaired rows stay single-sided. Confirmed data-entry typos live in its `CORRECTIONS` table. Checks: all 18 account balances, all 7 allocation-tag totals, all 59 claims (open/settled, per receivable account) against the sheet.
- `migration/transform-budgets.py [year]` — `Verlauf` tab → Plan0 + Plan1 budgets and their breakdown-line grouping tags (Prog is not imported — computed live). Checks: group totals per month against the Verlauf summary rows, savings actuals per month against the Prog rows.
- `migration/out/` — **gitignored**, generated output (real personal data). **This repo is public (GitHub Pages) — nothing personal may ever be committed.** The generated files will reach Firestore via the app's one-time import screen (file picker, not bundled into the public app).

To regenerate: export each year's sheet from Markus's Google Drive as `.xlsx` (the Drive connector's download with the xlsx export type keeps every tab — CSV export only gives the first tab), save it at the path in each script's `SRC` constant, then run in this order: `transform-transactions.py 2025`, `transform-transactions.py 2026` (needs the 2025 output), then `transform-budgets.py 2025` and `2026` (each reads its year's transactions for the savings check). Needs `openpyxl`.

## Screen-to-component map

Not started — `App.jsx` has no screens yet beyond the auth shell. This section gets real entries starting whenever Konten (Phase 1a) is built.

## Shared/pure calculation functions

Not started — `balance()` and the rest arrive in Phase 1a.

## Known duplication or drift to watch

*(Empty for now. If a future session notices two components doing similar things, or a pattern diverging from what's described here, that goes here as a flag for the next session — not silently fixed or silently ignored.)*
