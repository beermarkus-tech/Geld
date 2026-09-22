#!/usr/bin/env python3
"""
Transforms the 2025 'Konten' ledger export into transactions.json matching
spec.md §2.6's schema. See DEVLOG.md / this session's chat for the full
reasoning behind each rule below — this is not meant to be self-explanatory
without that context.
"""
import csv
import json
import re
from collections import defaultdict

SRC = "/tmp/claude-0/-home-user-Geld/579a8311-2b64-5844-81b1-64afabfc8004/scratchpad/konten.csv"
OUT = "/home/user/Geld/migration/seed/transactions-2025.json"
OPENING_OUT = "/home/user/Geld/migration/seed/jahresabschluss.json"

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
    m = re.match(r"Amazon (FR|DE) (Julia|Markus)", empfaenger)
    if m:
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

def load_rows():
    with open(SRC, newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
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
        txs.append({
            "id": f"jahresabschluss-{account_id}", "date": "2025-01-01",
            "fromAccountId": "jahresabschluss", "toAccountId": account_id,
            "amountCents": cents, "rawDescription": "Jahresabschluß",
            "displayLabel": "Jahresabschluß",
            "lines": [{"amountCents": cents, "categoryId": None, "note": "", "tags": tags or []}] if tags else [],
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
    lines = []
    total = 0
    for r in sparen_lines:
        cents = to_cents(parse_amount(r["teilwert"]))
        total += cents
        lines.append({"amountCents": cents, "categoryId": None, "note": "", "tags": [UNTERKONTEN_TAG_MAP[r["kategorie"]]]})
    txs.append({
        "id": "jahresabschluss-livret-a-sparen", "date": "2025-01-01",
        "fromAccountId": "jahresabschluss", "toAccountId": "livret-a-sparen",
        "amountCents": total, "rawDescription": "Jahresabschluß", "displayLabel": "Jahresabschluß",
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
        lines = []
        total = 0
        for r in sub:
            cents = to_cents(parse_amount(r["teilwert"]))
            total += cents
            lines.append({"amountCents": cents, "categoryId": None, "note": "", "tags": [UNTERKONTEN_TAG_MAP[r["kategorie"]]]})
        txs.append({
            "id": f"jahresabschluss-{acc_id}", "date": "2025-01-01",
            "fromAccountId": "jahresabschluss", "toAccountId": acc_id,
            "amountCents": total, "rawDescription": "Jahresabschluß", "displayLabel": "Jahresabschluß",
            "lines": lines, "detail": "", "createdAt": None,
        })

    # 5) Außenstände (open claims/loans carried over from 2024) — folded into
    # the 'Geld verliehen/geliehen' account's opening balance as one lump
    # sum, WITHOUT per-claim tags. This is a deliberate simplification, not
    # an oversight: individually tracking each pre-2025 open item would need
    # per-claim tagged lines here, but these are already-old claims (some
    # over a year stale by the time the app exists) — flagged to Markus as
    # an open item rather than silently done either way.
    ausenstaende_rows = [r for r in opening if r["gruppe"] == "Außenstände"]
    total = sum(to_cents(parse_amount(r["teilwert"])) for r in ausenstaende_rows)
    acc_line("geld-verliehen-geliehen", total)

    return txs


def main():
    rows = load_rows()

    opening = [r for r in rows if r["datum"] == "2024-12-31"]
    real = [r for r in rows if r["datum"] != "2024-12-31"]

    opening_txs = build_opening_transactions(opening)
    with open(OPENING_OUT, "w") as f:
        json.dump(opening_txs, f, ensure_ascii=False, indent=2)
    print(f"wrote {len(opening_txs)} opening-balance transactions to {OPENING_OUT}")
    print(f"  total opening balance across all accounts: {sum(t['amountCents'] for t in opening_txs)/100:.2f} EUR")

    transactions = []
    tx_id = 0
    def next_id():
        nonlocal tx_id
        tx_id += 1
        return f"tx-2025-{tx_id:05d}"

    # index for locating a row's mirror ('Unterkonten' rows are the other
    # half of an allocation-transfer already captured via its 'Rücklagen' pair)
    unhandled = list(real)
    skipped_scratch_totals = 0
    skipped_unterkonten_mirrors = 0
    plain_transfers = 0
    allocation_transfers = 0
    receivable_transactions = 0
    split_groups = 0
    single_line = 0
    errors = []
    dropped_ohne_rows = []

    # Pass 1: drop blank-total scratch rows (no Gruppe/Kategorie/Transfer,
    # and real categorized lines exist for the same date+payee elsewhere)
    groups_by_date_payee = defaultdict(list)
    for r in real:
        groups_by_date_payee[(r["datum"], r["empfaenger"])].append(r)

    def is_scratch_total(r):
        if r["gruppe"] or r["kategorie"] or r["transfer"]:
            return False
        grp = groups_by_date_payee[(r["datum"], r["empfaenger"])]
        return any(x["gruppe"] for x in grp if x is not r)

    real = [r for r in real if not is_scratch_total(r)]
    skipped_scratch_totals = len(rows) - len(opening) - len(real)

    # Pass 2: any transfer-flagged row can be recorded TWICE in the old
    # sheet — once from each account's own perspective (same date, Konto and
    # Transfer swapped, same magnitude, opposite sign; often even a
    # different Empfänger label per side, e.g. "Markus Beer" vs "Übertrag" —
    # confirmed by tracing a real deep-negative Consors-Konto balance back
    # to exactly this: a genuine replenishment transfer's two mirror rows
    # were being built as two separate transactions, netting to zero
    # instead of registering once). Keep exactly one row per real transfer;
    # prefer the categorized side (Rücklagen over its Unterkonten mirror)
    # when only one side carries a category, otherwise prefer the
    # negative-signed side (the 'outflow from fromAccountId' framing).
    def mirror_of(r):
        if not r["transfer"]:
            return None
        r_amt = parse_amount(r["wert"]) if r["wert"] else parse_amount(r["teilwert"])
        for other in real:
            if other is r:
                continue
            if other["datum"] != r["datum"] or other["konto"] != r["transfer"] or other["transfer"] != r["konto"]:
                continue
            o_amt = parse_amount(other["wert"]) if other["wert"] else parse_amount(other["teilwert"])
            if o_amt is None or r_amt is None:
                continue
            if abs(o_amt + r_amt) < 0.02:  # opposite sign, same magnitude
                return other
        return None

    skipped_unterkonten_mirrors = 0
    already_dropped = set()
    for r in list(real):
        if id(r) in already_dropped:
            continue
        m = mirror_of(r)
        if m is None or id(m) in already_dropped:
            continue
        # prefer the row carrying a real category (Rücklagen over its
        # blank/Unterkonten mirror); otherwise prefer the negative side
        keep, drop = r, m
        if not keep["gruppe"] and drop["gruppe"]:
            keep, drop = drop, keep
        elif keep["gruppe"] == drop["gruppe"]:
            r_amt = parse_amount(keep["wert"]) if keep["wert"] else parse_amount(keep["teilwert"])
            if r_amt is not None and r_amt > 0:
                keep, drop = drop, keep
        already_dropped.add(id(drop))

    before = len(real)
    real = [r for r in real if id(r) not in already_dropped]
    skipped_unterkonten_mirrors = before - len(real)

    # Pass 3: classify and build transactions
    handled_ids = set()
    for i, r in enumerate(real):
        if id(r) in handled_ids:
            continue
        amt = parse_amount(r["wert"]) if r["wert"] else parse_amount(r["teilwert"])
        if amt is None:
            errors.append(("no amount", r))
            continue
        cents = to_cents(amt)

        if r["konto"] == "Ohne" and not r["transfer"]:
            dropped_ohne_rows.append(r)
            continue

        if r["gruppe"] == "Rücklagen" and r["transfer"]:
            # allocation transfer: one row is enough, no separate mirror needed
            from_id = ACCOUNT_MAP.get(r["konto"])
            to_id = ACCOUNT_MAP.get(r["transfer"])
            tag = ALLOCATION_TAG_MAP.get(r["kategorie"])
            if not (from_id and to_id and tag):
                errors.append(("unmapped allocation transfer", r))
                continue
            transactions.append({
                "id": next_id(), "date": r["datum"],
                "fromAccountId": from_id, "toAccountId": to_id,
                "amountCents": cents,
                "rawDescription": r["empfaenger"], "displayLabel": r["empfaenger"],
                "lines": [{"amountCents": cents, "categoryId": None, "note": r["details"], "tags": [tag]}],
                "detail": r["details"], "createdAt": None,
            })
            allocation_transfers += 1
            continue

        if r["gruppe"] == "Außenstände":
            recv_id = receivable_account_for(r["empfaenger"], r["verliehen"])
            real_acc_id = ACCOUNT_MAP.get(r["konto"])
            if not real_acc_id:
                errors.append(("unmapped receivable-side real account", r))
                continue
            claim_tag = claim_tag_for(r["verliehen"], r["tag2"])
            if cents < 0:
                from_id, to_id = real_acc_id, recv_id
            else:
                from_id, to_id = recv_id, real_acc_id
            transactions.append({
                "id": next_id(), "date": r["datum"],
                "fromAccountId": from_id, "toAccountId": to_id,
                "amountCents": cents,
                "rawDescription": r["empfaenger"], "displayLabel": r["empfaenger"],
                "lines": [{"amountCents": cents, "categoryId": None, "note": r["details"], "tags": [claim_tag]}],
                "detail": r["details"], "createdAt": None,
            })
            receivable_transactions += 1
            continue

        if r["transfer"] and not r["gruppe"]:
            from_id = ACCOUNT_MAP.get(r["konto"])
            to_id = ACCOUNT_MAP.get(r["transfer"])
            if not (from_id and to_id):
                errors.append(("unmapped plain transfer", r))
                continue
            transactions.append({
                "id": next_id(), "date": r["datum"],
                "fromAccountId": from_id, "toAccountId": to_id,
                "amountCents": cents,
                "rawDescription": r["empfaenger"], "displayLabel": r["empfaenger"],
                "lines": [],
                "detail": r["details"], "createdAt": None,
            })
            plain_transfers += 1
            continue

        if r["gruppe"] and r["gruppe"] not in ("Rücklagen", "Außenstände", "Unterkonten"):
            # normal categorized row — group with siblings sharing date+payee
            key = (r["datum"], r["empfaenger"])
            siblings = [x for x in groups_by_date_payee[key]
                        if x in real and id(x) not in handled_ids
                        and x["gruppe"] and x["gruppe"] not in ("Rücklagen", "Außenstände", "Unterkonten")]
            if len(siblings) > 1:
                split_groups += 1
            else:
                single_line += 1
            lines = []
            total_cents = 0
            for s in siblings:
                samt = parse_amount(s["wert"]) if s["wert"] else parse_amount(s["teilwert"])
                scents = to_cents(samt)
                total_cents += scents
                tags = []
                if s["tag1"]:
                    tags.append(s["tag1"])
                if s["tag2"]:
                    tags.append(s["tag2"])
                lines.append({
                    "amountCents": scents,
                    "categoryId": category_id(s["gruppe"], s["kategorie"]),
                    "note": s["details"], "tags": tags,
                })
                handled_ids.add(id(s))
            acc_id = ACCOUNT_MAP.get(r["konto"])
            if not acc_id:
                errors.append(("unmapped account", r))
                continue
            if total_cents >= 0:
                from_id, to_id = None, acc_id
            else:
                from_id, to_id = acc_id, None
            transactions.append({
                "id": next_id(), "date": r["datum"],
                "fromAccountId": from_id, "toAccountId": to_id,
                "amountCents": total_cents,
                "rawDescription": r["empfaenger"], "displayLabel": r["empfaenger"],
                "lines": lines,
                "detail": r["details"], "createdAt": None,
            })
            continue

        if r["gruppe"] == "Unterkonten":
            # standalone allocation transfer (no paired 'Rücklagen' row —
            # a plain savings<->checking reallocation, not an investment buy)
            from_id = ACCOUNT_MAP.get(r["konto"])
            # No Transfer target at all: an internal reallocation within the
            # same tracked account (e.g. swapping one crypto holding for
            # another) — model as a same-account transaction so it nets to
            # zero rather than forcing a fake second account.
            to_id = ACCOUNT_MAP.get(r["transfer"]) if r["transfer"] else from_id
            tag = UNTERKONTEN_TAG_MAP.get(r["kategorie"])
            if not (from_id and to_id and tag):
                errors.append(("unmapped standalone Unterkonten transfer", r))
                continue
            transactions.append({
                "id": next_id(), "date": r["datum"],
                "fromAccountId": from_id, "toAccountId": to_id,
                "amountCents": cents,
                "rawDescription": r["empfaenger"], "displayLabel": r["empfaenger"],
                "lines": [{"amountCents": cents, "categoryId": None, "note": r["details"], "tags": [tag]}],
                "detail": r["details"], "createdAt": None,
            })
            allocation_transfers += 1
            continue

        errors.append(("unclassified row", r))

    print(f"scratch totals dropped: {skipped_scratch_totals}")
    print(f"unterkonten mirrors dropped: {skipped_unterkonten_mirrors}")
    print(f"plain transfers: {plain_transfers}")
    print(f"allocation transfers: {allocation_transfers}")
    print(f"receivable transactions: {receivable_transactions}")
    print(f"split groups: {split_groups}, single-line: {single_line}")
    print(f"total transactions built: {len(transactions)}")
    print(f"'Ohne' virtual-placeholder rows dropped (net {sum(to_cents(parse_amount(r['wert']) if r['wert'] else parse_amount(r['teilwert'])) for r in dropped_ohne_rows)/100:.2f} EUR, touched no real account either way):")
    for r in dropped_ohne_rows:
        print("  ", r["datum"], r["empfaenger"], r["gruppe"], r["kategorie"], r["wert"] or r["teilwert"])
    print(f"errors: {len(errors)}")
    for kind, r in errors[:30]:
        print(" ", kind, "|", r["datum"], r["konto"], r["transfer"], r["empfaenger"], r["gruppe"], r["kategorie"], r["wert"], r["teilwert"])

    with open(OUT, "w") as f:
        json.dump(transactions, f, ensure_ascii=False, indent=2)
    print(f"wrote {OUT}")

if __name__ == "__main__":
    main()
