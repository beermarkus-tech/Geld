#!/usr/bin/env python3
"""
Transforms the 2025 'Konten' ledger export into transactions.json matching
spec.md §2.6's schema. See DEVLOG.md / this session's chat for the full
reasoning behind each rule below — this is not meant to be self-explanatory
without that context.
"""
import json
import re
from collections import defaultdict
from datetime import date

# The "Geld 2025" Google Sheet exported as .xlsx (Drive export keeps every tab;
# CSV export would only give the first one). See CODEMAP.md for how to get it.
SRC = "/tmp/claude-0/-home-user-Geld/579a8311-2b64-5844-81b1-64afabfc8004/scratchpad/geld2025.xlsx"
OUT = "/home/user/Geld/migration/out/transactions-2025.json"
OPENING_OUT = "/home/user/Geld/migration/out/jahresabschluss.json"

# --- account name mapping: old sheet 'Konto' string -> new account id ---
ACCOUNT_MAP = {
    "BNP-Konto": "bnp-konto",
    "DKB-Konto": "dkb-konto",
    "Paypal": "paypal",
    "PayPal": "paypal",
    "Visa AIRBUS": "visa-airbus",
    "Livret A Sparen": "livret-a-sparen",
    "Livret A Tagesgeld": "livret-a-tagesgeld",
    "Consors-Konto": "consors-verrechnungskonto",
    "Smartbroker": "smartbroker-verrechnungskonto",
    "Coinbase": "coinbase-verrechnungskonto",
    "Bar Markus": "bar-markus",
    "Bar Julia": "bar-julia",
    "Bar Haus": "bar-haus",
    "CheqVac": "cheqvac",
    "eCESU": "ecesu",
    "Aktien": "aktien",
    "Crypto": "crypto",
    "Edelmetalle": "edelmetalle",
    "ESOP": "esop",
}

# --- category mapping: (Gruppe, Kategorie) -> category id, from categories.json ---
with open("/home/user/Geld/migration/seed/categories.json") as f:
    CATEGORIES = json.load(f)
CAT_BY_NAME = {c["name"]: c["id"] for c in CATEGORIES}
GROUP_ID_BY_NAME = {c["name"]: c["id"] for c in CATEGORIES if c["parentCategoryId"] is None}

def category_id(gruppe, kategorie):
    cid = CAT_BY_NAME.get(kategorie.strip())
    if cid is None:
        raise ValueError(f"Unknown category: Gruppe={gruppe!r} Kategorie={kategorie!r}")
    return cid

# --- allocation tag mapping: 'Für X' Kategorie value -> allocation tag id ---
ALLOCATION_TAG_MAP = {
    "Für Sparen Familie": "sparen-familie",
    "Für Sparen Sophia": "sparen-sophia",
    "Für Sparen Julia": "sparen-julia",
    "Für Steuern": "ruecklagen-steuern",
    "Für Anlage Familie": "anlage-familie",
    "Für Anlage Sophia": "anlage-sophia",
    "Für Tagesgeld": "tagesgeld",
}
# Unterkonten group's Kategorie value is the *plain* tag name (Anlage Familie,
# not "Für Anlage Familie") — same tag, different label on the mirror row.
UNTERKONTEN_TAG_MAP = {
    "Anlage Familie": "anlage-familie",
    "Anlage Sophia": "anlage-sophia",
    "Tagesgeld": "tagesgeld",
    "Sparen Familie": "sparen-familie",
    "Sparen Sophia": "sparen-sophia",
    "Sparen Julia": "sparen-julia",
    "Steuern": "ruecklagen-steuern",
}

# --- receivable-account routing for Außenstände / Verliehen-tagged rows ---
def receivable_account_for(empfaenger, verliehen):
    # Route by who owes the money (Verliehen), not by where it was spent: a
    # loan to a relative for something bought on Amazon is not an Amazon return.
    if verliehen == "Amazon":
        m = re.match(r"Amazon (FR|DE) (Julia|Markus)", empfaenger)
        if not m:
            raise ValueError(f"Amazon claim without an 'Amazon FR/DE Julia/Markus' payee: {empfaenger!r}")
        country, person = m.groups()
        return f"amazon-{person.lower()}-{country.lower()}"
    if verliehen == "MSH":
        return "cpam"
    if verliehen == "Airbus":
        return "reisekosten-airbus"
    return "geld-verliehen-geliehen"

def claim_tag_for(verliehen, tag2):
    # Tag2 (a CFW claim ref or an Airbus 'YYYY-MM XXX' claim code) is the real
    # claim identifier when present; otherwise fall back to the counterparty
    # name itself as an informal-loan tag.
    return tag2.strip() if tag2.strip() else verliehen.strip()

def parse_amount(s):
    s = s.strip().replace("€", "").replace(" ", "")
    if not s:
        return None
    return float(s)

def to_cents(f):
    return round(f * 100)

# Data-entry typos in the Gsheet, each confirmed by Markus. Keyed by
# (date, Konto, Empfänger) -> {field: corrected value}.
CORRECTIONS = {
    # Transfer column said Livret A Tagesgeld; counterpart is on Livret A Sparen.
    ("2025-10-16", "BNP-Konto", "Ausgleich Taxe Fonciere"): {"transfer": "Livret A Sparen"},
    # Booked on the 'Ohne' placeholder; actually paid cash, claimable from Airbus.
    ("2025-12-31", "Ohne", "Kantine Hamburg"): {"konto": "Bar Markus"},
}


def load_rows():
    rows = _load_raw_rows()
    for r in rows:
        fix = CORRECTIONS.get((r["datum"], r["konto"], r["empfaenger"]))
        if fix:
            r.update(fix)
    return rows


def _load_raw_rows():
    import openpyxl
    ws = openpyxl.load_workbook(SRC, data_only=True)["Konten"]
    rows = [["" if v is None else str(v) for v in r] for r in ws.iter_rows(values_only=True)]
    header = rows[10]
    def col(r, name):
        idx = header.index(name)
        return r[idx] if idx < len(r) else ""
    out = []
    for r in rows[11:]:
        if len(r) < 16 or not col(r, "Datum").strip():
            continue
        out.append({
            "datum": col(r, "Datum")[:10],
            "konto": col(r, "Konto").strip(),
            "transfer": col(r, "Transfer").strip(),
            "empfaenger": col(r, "Empfänger").strip(),
            "wert": col(r, "Wert").strip(),
            "teilwert": col(r, "Teilwert").strip(),
            "gruppe": col(r, "Gruppe").strip(),
            "kategorie": col(r, "Kategorie").strip(),
            "verliehen": col(r, "Verliehen").strip(),
            "details": col(r, "Details").strip(),
            "tag1": col(r, "Tag 1").strip(),
            "tag2": col(r, "Tag 2").strip(),
        })
    return out

def build_opening_transactions(opening):
    """One Jahresabschluß -> account transaction per real account, dated
    2025-01-01 (spec.md §2.3 — exactly one anchor, ever). 'Ohne' rows are
    always just scratch reference totals here (the real per-account
    breakdown is in the Unterkonten sub-lines) and are dropped."""
    txs = []

    def acc_line(account_id, cents, tags=None):
        # amountCents is always a positive magnitude for a two-account
        # transaction (spec.md §2.6 clarification) — a negative opening
        # balance (e.g. Visa Airbus, a credit card debt) means the account
        # itself is the 'from' side, jahresabschluss the 'to' side, not the
        # other way around with a negative amount.
        from_id, to_id = ("jahresabschluss", account_id) if cents >= 0 else (account_id, "jahresabschluss")
        abs_cents = abs(cents)
        txs.append({
            "id": f"jahresabschluss-{account_id}", "date": "2025-01-01",
            "fromAccountId": from_id, "toAccountId": to_id,
            "amountCents": abs_cents, "rawDescription": "Jahresabschluß",
            "displayLabel": "Jahresabschluß",
            "lines": [{"amountCents": abs_cents, "categoryId": None, "note": "", "tags": tags or []}] if tags else [],
            "detail": "", "createdAt": None,
        })

    # 1) direct real accounts: one row each, no Unterkonten breakdown
    direct = {
        "DKB-Konto": "dkb-konto", "BNP-Konto": "bnp-konto",
        "Consors-Konto": "consors-verrechnungskonto", "Coinbase": "coinbase-verrechnungskonto",
        "Paypal": "paypal", "Bar Markus": "bar-markus", "Bar Julia": "bar-julia",
        "Bar Haus": "bar-haus", "CheqVac": "cheqvac", "eCESU": "ecesu",
    }
    for konto, acc_id in direct.items():
        matches = [r for r in opening if r["konto"] == konto and r["teilwert"] and not r["gruppe"]]
        if len(matches) != 1:
            raise ValueError(f"expected exactly one direct opening row for {konto}, got {len(matches)}")
        acc_line(acc_id, to_cents(parse_amount(matches[0]["teilwert"])))

    # Visa Airbus: appears twice (a Wert scratch + the real Teilwert row) — use Teilwert
    visa = [r for r in opening if r["konto"] == "Visa AIRBUS" and r["teilwert"]]
    acc_line("visa-airbus", to_cents(parse_amount(visa[0]["teilwert"])))

    # 2) Livret A Sparen — one transaction, 4 allocation-tagged lines
    sparen_lines = [r for r in opening if r["konto"] == "Livret A Sparen" and r["gruppe"] == "Unterkonten"]
    raw_lines = [(to_cents(parse_amount(r["teilwert"])), UNTERKONTEN_TAG_MAP[r["kategorie"]]) for r in sparen_lines]
    total = sum(c for c, _ in raw_lines)
    sign = 1 if total >= 0 else -1
    from_id, to_id = ("jahresabschluss", "livret-a-sparen") if total >= 0 else ("livret-a-sparen", "jahresabschluss")
    lines = [{"amountCents": c * sign, "categoryId": None, "note": "", "tags": [tag]} for c, tag in raw_lines]
    txs.append({
        "id": "jahresabschluss-livret-a-sparen", "date": "2025-01-01",
        "fromAccountId": from_id, "toAccountId": to_id,
        "amountCents": abs(total), "rawDescription": "Jahresabschluß", "displayLabel": "Jahresabschluß",
        "lines": lines, "detail": "", "createdAt": None,
    })

    # 3) Livret A Tagesgeld — 1:1 with the Tagesgeld tag
    tg = [r for r in opening if r["konto"] == "Livret A Tagesgeld" and r["gruppe"] == "Unterkonten"][0]
    acc_line("livret-a-tagesgeld", to_cents(parse_amount(tg["teilwert"])), ["tagesgeld"])

    # 4) Investment-tracking accounts (Aktien/Crypto/Edelmetalle/ESOP) — each
    # is its own real account, but its opening balance is split across the
    # Anlage Familie / Anlage Sophia allocation tags (both may apply).
    inv_accounts = {"Aktien": "aktien", "Crypto": "crypto", "Edelmetalle": "edelmetalle", "ESOP": "esop"}
    for konto, acc_id in inv_accounts.items():
        sub = [r for r in opening if r["konto"] == konto and r["gruppe"] == "Unterkonten"]
        raw_lines = [(to_cents(parse_amount(r["teilwert"])), UNTERKONTEN_TAG_MAP[r["kategorie"]]) for r in sub]
        total = sum(c for c, _ in raw_lines)
        sign = 1 if total >= 0 else -1
        from_id, to_id = ("jahresabschluss", acc_id) if total >= 0 else (acc_id, "jahresabschluss")
        lines = [{"amountCents": c * sign, "categoryId": None, "note": "", "tags": [tag]} for c, tag in raw_lines]
        txs.append({
            "id": f"jahresabschluss-{acc_id}", "date": "2025-01-01",
            "fromAccountId": from_id, "toAccountId": to_id,
            "amountCents": abs(total), "rawDescription": "Jahresabschluß", "displayLabel": "Jahresabschluß",
            "lines": lines, "detail": "", "createdAt": None,
        })

    # 5) Claims/loans still open at the end of 2024 — one opening transaction
    # per receivable account, one tagged line per claim, so each claim can
    # be seen closing when its 2025 settlement arrives. In the sheet a
    # negative row means money went out (owed to us), so the receivable's
    # own balance is the negation.
    by_recv = defaultdict(list)
    for r in opening:
        if r["verliehen"] and r["teilwert"]:
            by_recv[opening_receivable_for(r)].append(r)
    for recv, rs in sorted(by_recv.items()):
        lines = [{"amountCents": -to_cents(parse_amount(r["teilwert"])), "categoryId": None,
                  "note": r["details"], "tags": [claim_tag_for(r["verliehen"], r["tag2"])]} for r in rs]
        total = sum(l["amountCents"] for l in lines)
        txs.append({
            "id": f"jahresabschluss-{recv}", "date": "2025-01-01",
            "fromAccountId": "jahresabschluss", "toAccountId": recv,
            "amountCents": total, "rawDescription": "Jahresabschluß", "displayLabel": "Jahresabschluß",
            "lines": lines, "detail": "", "createdAt": None,
        })

    return txs


def opening_receivable_for(r):
    # Opening rows carry no Amazon payee label to route by; all three
    # carried-over Amazon items were refunded on "Amazon FR Julia" in 2025.
    if r["verliehen"] == "Amazon":
        return "amazon-julia-fr"
    return receivable_account_for(r["empfaenger"], r["verliehen"])


TAGGED_GROUPS = ("Rücklagen", "Unterkonten")
PAIR_WINDOW_DAYS = 45


def row_tag(r):
    if r["gruppe"] == "Rücklagen":
        return ALLOCATION_TAG_MAP.get(r["kategorie"])
    if r["gruppe"] == "Unterkonten":
        return UNTERKONTEN_TAG_MAP.get(r["kategorie"])
    return None


def pair_transfers(rows):
    """Pairs each transfer row (Konto=A, Transfer=B, value v) with its
    counterpart row on the other account (Konto=B, Transfer=A, value -v).

    The old sheet books every row only against its own Konto (the header
    totals are plain SUMIF(Konto, Teilwert)), so a transfer normally appears
    twice — once per account. The two legs can be days apart and carry
    different payee labels. Greedy global matching: same payee first, then
    closest date. Rows left over have no counterpart and must stay
    single-sided, or they'd invent money on the other account."""
    candidates = []
    for i, a in enumerate(rows):
        for j in range(i + 1, len(rows)):
            b = rows[j]
            if a["konto"] != b["transfer"] or a["transfer"] != b["konto"]:
                continue
            if to_cents(parse_amount(a["teilwert"])) != -to_cents(parse_amount(b["teilwert"])):
                continue
            gap = abs((date.fromisoformat(a["datum"]) - date.fromisoformat(b["datum"])).days)
            if gap > PAIR_WINDOW_DAYS:
                continue
            candidates.append((a["empfaenger"] != b["empfaenger"], gap, i, j))
    candidates.sort()
    used, pairs = set(), []
    for _, _, i, j in candidates:
        if i in used or j in used:
            continue
        used.update((i, j))
        pairs.append((rows[i], rows[j]))
    unpaired = [r for k, r in enumerate(rows) if k not in used]
    return pairs, unpaired


def verify_account_sums(rows, transactions):
    """Hard check: every real account must end the year exactly at
    Σ Teilwert over its own rows — the sheet's own header formula."""
    expected = defaultdict(int)
    for r in rows:
        acc = ACCOUNT_MAP.get(r["konto"])
        if acc and r["teilwert"]:
            expected[acc] += to_cents(parse_amount(r["teilwert"]))
    actual = defaultdict(int)
    for t in transactions:
        f, to, a = t["fromAccountId"], t["toAccountId"], t["amountCents"]
        if f and to:
            actual[f] -= a
            actual[to] += a
        elif f:
            actual[f] += a
        elif to:
            actual[to] += a
    ok = True
    for acc in sorted(set(expected) | set(ACCOUNT_MAP.values())):
        e, a = expected.get(acc, 0), actual.get(acc, 0)
        flag = "OK " if e == a else "BAD"
        if e != a:
            ok = False
        print(f"  {flag} {acc:32s} expected {e/100:>11,.2f}  got {a/100:>11,.2f}")
    return ok


def allocation_tag_delta(tx, line, targets):
    """A tagged line's effect on its allocation tag's balance: follows the
    money into or out of the tag's own account(s), exactly like the
    account-balance rule (spec.md §2.6/§2.8)."""
    f, to = tx["fromAccountId"], tx["toAccountId"]
    if f and to:
        if to in targets and f not in targets:
            return line["amountCents"]
        if f in targets and to not in targets:
            return -line["amountCents"]
        raise ValueError(f"tagged transfer with no clear direction for its tag: {tx['id']}")
    return line["amountCents"]


def verify_tag_sums(rows, transactions):
    with open("/home/user/Geld/migration/seed/tags-allocation.json") as f:
        targets = {t["id"]: set(t["reconciliationTargetAccountIds"]) for t in json.load(f)}
    expected = defaultdict(int)
    for r in rows:
        if r["gruppe"] == "Unterkonten" and r["teilwert"] and r["konto"] != "Ohne":
            expected[UNTERKONTEN_TAG_MAP[r["kategorie"]]] += to_cents(parse_amount(r["teilwert"]))
    actual = defaultdict(int)
    for t in transactions:
        for line in t["lines"]:
            for tag in line["tags"]:
                if tag in targets:
                    actual[tag] += allocation_tag_delta(t, line, targets[tag])
    ok = True
    for tag in sorted(targets):
        e, a = expected.get(tag, 0), actual.get(tag, 0)
        if e != a:
            ok = False
        print(f"  {'OK ' if e == a else 'BAD'} {tag:32s} expected {e/100:>11,.2f}  got {a/100:>11,.2f}")
    return ok


def verify_claims(rows, transactions):
    """The sheet's open-items total is Σ Teilwert of rows with a Verliehen
    name (negative = owed to us). Receivable accounts hold the mirror image,
    so their balances must sum to its negation, and every claim tag must be
    open by exactly the amount the sheet shows for that claim."""
    with open("/home/user/Geld/migration/seed/accounts.json") as f:
        receivables = {a["id"] for a in json.load(f) if a["group"] == "receivable"}
    expected = defaultdict(int)
    for r in rows:
        if r["verliehen"] and r["teilwert"]:
            expected[claim_tag_for(r["verliehen"], r["tag2"])] -= to_cents(parse_amount(r["teilwert"]))
    actual, recv_bal, per_acc = defaultdict(int), defaultdict(int), defaultdict(int)
    for t in transactions:
        f, to, a = t["fromAccountId"], t["toAccountId"], t["amountCents"]
        if f in receivables and to:
            recv_bal[f] -= a
        if to in receivables and f:
            recv_bal[to] += a
        if bool(f) != bool(to) and (f or to) in receivables:
            recv_bal[f or to] += a
        recv = f if f in receivables else to if to in receivables else None
        if not recv:
            continue
        for line in t["lines"]:
            for tag in line["tags"]:
                if tag in expected:
                    d = allocation_tag_delta(t, line, receivables)
                    actual[tag] += d
                    per_acc[(recv, tag)] += d
    ok = True
    for tag in sorted(set(expected) | set(actual)):
        e, a = expected.get(tag, 0), actual.get(tag, 0)
        if e != a:
            ok = False
            print(f"  BAD claim {tag:16s} expected open {e/100:>9.2f}  got {a/100:>9.2f}")
    open_claims = {k: v for k, v in actual.items() if v}
    print(f"  {'OK ' if ok else 'BAD'} {len(expected)} claims: {len(open_claims)} open, "
          f"{len(expected) - len(open_claims)} settled")
    for tag, v in sorted(open_claims.items()):
        print(f"        open: {tag:16s} {v/100:>9.2f}")
    # Each receivable account must hold exactly its own open claims — no
    # leftover from a claim that was settled on a different account.
    stray = {k: v for k, v in per_acc.items() if v and not actual.get(k[1])}
    for (acc, tag), v in sorted(stray.items()):
        ok = False
        print(f"  BAD settled claim {tag} leaves {v/100:.2f} on {acc}")
    total_e, total_a = sum(expected.values()), sum(recv_bal.values())
    ok = ok and total_e == total_a
    print(f"  {'OK ' if total_e == total_a else 'BAD'} Σ receivable accounts: expected {total_e/100:.2f}  got {total_a/100:.2f}")
    for acc in sorted(receivables):
        print(f"        {acc:28s} {recv_bal.get(acc, 0)/100:>9.2f}")
    return ok


def main():
    rows = load_rows()
    opening = [r for r in rows if r["datum"] == "2024-12-31"]

    opening_txs = build_opening_transactions(opening)
    with open(OPENING_OUT, "w") as f:
        json.dump(opening_txs, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(opening_txs)} opening-balance transactions")

    # Only Teilwert rows ever count toward a balance; 'Wert' is the sheet's
    # own reference total and is never summed (verified against the header).
    real = [r for r in rows if r["datum"] != "2024-12-31" and r["teilwert"]]
    ohne_rows = [r for r in real if r["konto"] == "Ohne"]
    real = [r for r in real if r["konto"] != "Ohne"]

    transactions = []
    counter = 0
    def new_tx(**kw):
        nonlocal counter
        counter += 1
        t = {"id": f"tx-2025-{counter:05d}", "rawDescription": kw.get("displayLabel", ""),
             "detail": "", "createdAt": None}
        t.update(kw)
        transactions.append(t)

    transfer_rows = [r for r in real if r["transfer"]]
    other_rows = [r for r in real if not r["transfer"]]

    # --- transfers ---------------------------------------------------------
    pairs, unpaired = pair_transfers(transfer_rows)

    # A pair on the SAME account (Rücklagen "Für X" / Unterkonten "X") is the
    # sheet's way of re-tagging money inside one account — used where
    # interest or an expense hit a savings account directly. In the app that
    # is just a tag on the real income/expense line itself, so it becomes a
    # tag on that line instead of a transaction. Keyed by the Unterkonten
    # row's value, which is the tag's actual change.
    retags = {}
    cross_pairs = []
    for a, b in pairs:
        if a["konto"] != b["konto"]:
            cross_pairs.append((a, b))
            continue
        unter = a if a["gruppe"] == "Unterkonten" else b
        key = (unter["datum"], unter["empfaenger"], unter["konto"], to_cents(parse_amount(unter["teilwert"])))
        retags[key] = row_tag(unter)

    for a, b in cross_pairs:
        out, inc = (a, b) if to_cents(parse_amount(a["teilwert"])) < 0 else (b, a)
        amount = abs(to_cents(parse_amount(out["teilwert"])))
        tag = row_tag(out) or row_tag(inc)
        details = " / ".join(d for d in (out["details"], inc["details"]) if d)
        new_tx(date=out["datum"],
               fromAccountId=ACCOUNT_MAP[out["konto"]], toAccountId=ACCOUNT_MAP[inc["konto"]],
               amountCents=amount, displayLabel=out["empfaenger"],
               lines=[{"amountCents": amount, "categoryId": None, "note": "", "tags": [tag]}] if tag else [],
               detail=details)

    for r in unpaired:
        v = to_cents(parse_amount(r["teilwert"]))
        acc = ACCOUNT_MAP[r["konto"]]
        tag = row_tag(r)
        new_tx(date=r["datum"],
               fromAccountId=acc if v < 0 else None, toAccountId=acc if v >= 0 else None,
               amountCents=v, displayLabel=r["empfaenger"],
               lines=[{"amountCents": v, "categoryId": None, "note": "", "tags": [tag]}] if tag else [],
               detail=(r["details"] + " — " if r["details"] else "")
                      + f"Gegenbuchung auf {r['transfer']} fehlt im Gsheet")

    # --- claims & loans (Außenstände) -------------------------------------
    # The sheet's own open-items total is Σ Teilwert of every row carrying a
    # Verliehen name — regardless of Gruppe — so that is what marks a claim
    # row here too (e.g. the UK ETA visa fee, booked under Urlaube but marked
    # Verliehen=Airbus and reimbursed by Airbus a month later).
    claim_rows = [r for r in other_rows if r["verliehen"]]
    for r in claim_rows:
        v = to_cents(parse_amount(r["teilwert"]))
        real_acc = ACCOUNT_MAP[r["konto"]]
        recv = receivable_account_for(r["empfaenger"], r["verliehen"])
        f, to = (real_acc, recv) if v < 0 else (recv, real_acc)
        tags = [claim_tag_for(r["verliehen"], r["tag2"])] + ([r["tag1"]] if r["tag1"] else [])
        new_tx(date=r["datum"], fromAccountId=f, toAccountId=to, amountCents=abs(v),
               displayLabel=r["empfaenger"], detail=r["details"],
               lines=[{"amountCents": abs(v), "categoryId": None, "note": r["details"], "tags": tags}])

    # 'Ohne' = the sheet's virtual placeholder, never a real account. In 2025
    # it only carries claim bookkeeping that touches no real account: a claim
    # written off as an expense (spec.md §3g close-out), or an amount added
    # to a claim. Booked single-sided on the claim's receivable account; any
    # non-claim rows alongside become the (categorized) lines.
    ohne_groups = defaultdict(list)
    for r in ohne_rows:
        ohne_groups[(r["datum"], r["empfaenger"])].append(r)
    for (d, payee), grp in ohne_groups.items():
        claim = [r for r in grp if r["verliehen"]]
        if not claim:
            raise ValueError(f"'Ohne' rows with no claim to attach to: {grp}")
        recv = receivable_account_for(payee, claim[0]["verliehen"])
        tag = claim_tag_for(claim[0]["verliehen"], claim[0]["tag2"])
        delta = -sum(to_cents(parse_amount(r["teilwert"])) for r in claim)
        lines = [{"amountCents": to_cents(parse_amount(r["teilwert"])),
                  "categoryId": category_id(r["gruppe"], r["kategorie"]), "note": r["details"], "tags": [tag]}
                 for r in grp if not r["verliehen"]]
        rest = delta - sum(l["amountCents"] for l in lines)
        if rest:
            lines.append({"amountCents": rest, "categoryId": None, "note": "", "tags": [tag]})
        new_tx(date=d, fromAccountId=recv if delta < 0 else None, toAccountId=recv if delta >= 0 else None,
               amountCents=delta, displayLabel=payee, lines=lines,
               detail=" / ".join(r["details"] for r in grp if r["details"]))

    # --- everything else: income/expense, split by (date, payee, account) --
    groups = defaultdict(list)
    for r in other_rows:
        if r["verliehen"]:
            continue
        groups[(r["datum"], r["empfaenger"], r["konto"])].append(r)
    for (d, payee, konto), grp in groups.items():
        lines = []
        for r in grp:
            v = to_cents(parse_amount(r["teilwert"]))
            if r["gruppe"] in TAGGED_GROUPS:
                cat, tags = None, [row_tag(r)]
            elif r["gruppe"]:
                cat, tags = category_id(r["gruppe"], r["kategorie"]), [t for t in (r["tag1"], r["tag2"]) if t]
            else:
                cat, tags = None, [t for t in (r["tag1"], r["tag2"]) if t]
            retag = retags.pop((d, payee, konto, v), None)
            if retag:
                tags.append(retag)
            lines.append({"amountCents": v, "categoryId": cat, "note": r["details"], "tags": tags})
        total = sum(l["amountCents"] for l in lines)
        acc = ACCOUNT_MAP[konto]
        new_tx(date=d, fromAccountId=acc if total < 0 else None, toAccountId=acc if total >= 0 else None,
               amountCents=total, displayLabel=payee, lines=lines,
               detail=" / ".join(r["details"] for r in grp if r["details"]))

    if retags:
        raise ValueError(f"same-account re-tag pairs with no matching income/expense line: {retags}")

    transactions.sort(key=lambda t: t["date"])

    print(f"transfer rows: {len(transfer_rows)} -> {len(cross_pairs)} transfers, "
          f"{len(pairs) - len(cross_pairs)} same-account re-tags folded into their line, "
          f"{len(unpaired)} without counterpart")
    for r in unpaired:
        print(f"    unpaired: {r['datum']} {r['konto']} -> {r['transfer']} | {r['empfaenger']} | {r['teilwert']}")
    print(f"claim rows: {len(claim_rows)} | 'Ohne' claim bookings: {len(ohne_groups)}")
    print(f"total transactions: {len(transactions)}")

    bad = [t for t in transactions if t["lines"] and sum(l["amountCents"] for l in t["lines"]) != t["amountCents"]]
    print(f"split-invariant violations: {len(bad)}")

    print("account totals vs. Gsheet header formula (Σ Teilwert per Konto):")
    ok = verify_account_sums(rows, opening_txs + transactions)

    print("allocation-tag totals vs. Gsheet header formula (Σ Unterkonten Teilwert per tag):")
    tags_ok = verify_tag_sums(rows, opening_txs + transactions)
    print("claims & loans vs. Gsheet open-items formula (Σ Teilwert where Verliehen is set):")
    tags_ok = verify_claims(rows, opening_txs + transactions) and tags_ok

    with open(OUT, "w") as f:
        json.dump(transactions, f, ensure_ascii=False, indent=2)
    print("ALL ACCOUNTS AND TAGS MATCH" if ok and tags_ok else "MISMATCH — see BAD rows above")


if __name__ == "__main__":
    main()
