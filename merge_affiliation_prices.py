#!/usr/bin/env python3
"""
Merge the old tracker's Opportunity Affiliations export into pricing_quotes,
so every quote carries the price that actually belongs to it.

    python3 merge_affiliation_prices.py --dry-run   # report + audit CSV, write nothing
    python3 merge_affiliation_prices.py             # do it

Why this exists
---------------
import_tracker.py built the quotes from the opportunities export's "Bid To:"
field, which is a semicolon-separated list of company names with no prices in
it. It took the prices from Proposal_Prices.csv and handed them out BY
POSITION — "only the first company inherits an amount". On a bid priced to
several companies that pairs the right prices with the wrong companies: on bid
2487, Turner was given IMC's $1,667,000 and IMC was given Turner's $1,828,000.

The affiliations export is the table those prices actually live on: one row per
company-on-a-bid, carrying that company's own price. So it can say which price
belongs to whom, which the earlier import could not.

What it writes
--------------
Only `price`, `price_sent_on`, `type`, `status` and `notes`, and only on quotes
the Aug 31 import created. Bids themselves are never touched — not their
status, not their value. If a bid's status looks wrong after this, that is the
opportunities export's job, not this one's.

Mapping decisions
-----------------
  which price   The export carries three generations of price field. In
                priority order:
                  Price                        the current form's field
                  Final Revised Proposal Price a revision supersedes the first
                  Current Price                a formula over the field below
                  Initial Proposal Price       the oldest flat field
                `Final Price` is ignored: 4,089 of its 4,748 values are $0, and
                where it is set it only ever repeats Initial Proposal Price.
                A revision beats Current Price because Current Price does not
                follow revisions — on Akin Gump it still reads the original
                $9,850 after the price was revised to $18,400.

  dates         Each price brings its own date: Price -> Price Sent On,
                a revision -> Revision Date, otherwise Initial Sent Date.

  type          Type of Price "Budget" -> budgetary, else proposal. Fixes 96
                budget quotes the first import had marked as proposals.

  status        Awarded -> Won, which is how 422 priced bids finally get a
                recorded winner. Sent/Lost/Withdrawn/Draft already match.

  no price      A quote whose affiliation row has no price has its price
                CLEARED. Those amounts were the positional guess and belong to
                another company on the bid, or to nobody.

  competitor /  Skipped. 23 rows, and not one has a price — a competitor is
  partner       someone we bid against, not someone we sent a price to.

  duplicates    110 (bid, company) pairs appear twice in the export. The row
                with a price wins, then Awarded, then the later Date Modified.

What it will not touch
----------------------
Any quote created after the Aug 31 import — those were typed into Battag Bid by
hand, and the export knows nothing about them. 102 quotes qualify, 87 of them
carrying a price, including one entered the same day this was written. Several
sit on imported bids, so "is it on an imported bid" is not a safe test; the
creation date is.

Rows this inserts are stamped with the import date rather than today, so they
join that same cohort and a later re-run treats them as imported history
instead of as somebody's hand-entered quote. It also keeps them ordered with
the rest of the import for the "most recent quote" rule in fetchQuotes().

Re-running is safe: it recomputes the same answer from the same export.
"""

import argparse
import collections
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.request

URL = "https://syxfuydxpuewhewmfajj.supabase.co"
KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG"
BATCH = 200

AFFILIATIONS_CSV = "/Users/tre/Downloads/Opportunity_Affiliations.csv"

# The snapshot that supabase_backup_20261027.sql makes. Nothing is written
# until it is there.
SNAPSHOT = "bk_20261027_pricing_quotes"

# The day import_tracker.py loaded the quotes. Only rows created on this day
# are the import's to overwrite.
IMPORT_DAY = "2026-08-31"
IMPORT_STAMP = f"{IMPORT_DAY}T00:00:00+00:00"

AUDIT_CSV = os.path.expanduser(
    "~/Desktop/BidTagglia/backups/pricing_merge_audit_20261027.csv"
)

csv.field_size_limit(sys.maxsize)

STATUS_MAP = {"Awarded": "Won"}
VALID_STATUS = {"Draft", "Sent", "Won", "Lost", "Withdrawn"}

# Price fields in the order they supersede each other, with the date field
# that belongs to each.
PRICE_FIELDS = [
    ("Price", "Price Sent On"),
    ("Final Revised Proposal Price", "Revision Date"),
    ("Current Price", "Initial Sent Date"),
    ("Initial Proposal Price", "Initial Sent Date"),
]


# ---------------------------------------------------------------------------
#  Shared with import_tracker.py
# ---------------------------------------------------------------------------

def read(path):
    # The exports are not valid UTF-8 (smart quotes in cp1252 byte ranges).
    with open(path, encoding="utf-8", errors="replace") as fh:
        return list(csv.DictReader(fh))


def num(v):
    """'$70,000,000' -> 70000000. Blank or unparseable -> None."""
    s = re.sub(r"[^0-9.\-]", "", v or "")
    if not s or s in {"-", "."}:
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f == int(f) else f


def date(v):
    """'09-07-2023 02:00 PM' -> '2023-09-07'. Blank -> None."""
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", (v or "").strip())
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


def company_key(name):
    """Matches companyKey() in dashboard.js, so a name pairs up here the same
    way the app groups it on screen."""
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def call(method, path, body=None, prefer=None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=headers,
                                 method=method)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {path} failed: {e.code} {e.read().decode()[:400]}")


def page_all(path):
    out = []
    step = 1000
    while True:
        joiner = "&" if "?" in path else "?"
        got = call("GET", f"{path}{joiner}limit={step}&offset={len(out)}")
        out += got
        if len(got) < step:
            return out


def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def dollars(v):
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"


# ---------------------------------------------------------------------------
#  The export
# ---------------------------------------------------------------------------

def strip_html(raw):
    """The notes field is stored as HTML. Paragraph and break tags become line
    breaks, every other tag goes, and the handful of entities the old system
    emits are turned back into characters."""
    s = raw or ""
    s = re.sub(r"(?i)</p\s*>|<br\s*/?>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    for entity, char in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
                         ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")]:
        s = s.replace(entity, char)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip() or None


def chosen_price(row):
    """The price that is current for this affiliation, which field it came
    from, and the date that field carries."""
    for field, date_field in PRICE_FIELDS:
        amount = num(row.get(field))
        if amount:
            return amount, field, date(row.get(date_field))
    return None, None, None


def note_for(row, field):
    """The affiliation's own notes, plus a line recording any earlier price
    this one supersedes — so correcting a price never silently loses the
    number that was there before."""
    parts = []
    own = strip_html(row.get("Notes"))
    if own:
        parts.append(own)

    initial = num(row.get("Initial Proposal Price")) or num(row.get("Current Price"))
    revised = num(row.get("Final Revised Proposal Price"))
    if field == "Final Revised Proposal Price" and initial and initial != revised:
        when = date(row.get("Revision Date"))
        parts.append(f"Revised from {dollars(initial)} to {dollars(revised)}"
                     + (f" on {when}." if when else "."))
    elif field == "Price" and initial and initial != num(row.get("Price")):
        parts.append(f"The old tracker also held an earlier proposal price of "
                     f"{dollars(initial)}.")
    return "\n\n".join(parts) or None


def rank(row):
    """Which of two rows for the same company on the same bid to believe."""
    amount, _, _ = chosen_price(row)
    modified = date(row.get("Date Modified")) or ""
    return (1 if amount else 0,
            1 if row.get("Status") == "Awarded" else 0,
            modified)


def build_wanted():
    """(legacy bid id, company key) -> what that quote should say."""
    rows = read(AFFILIATIONS_CSV)
    skipped = collections.Counter()
    best = {}

    for row in rows:
        legacy = (row.get("Related Opportunity") or "").strip()
        key = company_key(row.get("Company Name"))

        if row.get("Type") in {"competitor", "partner"}:
            skipped["competitor or partner, not someone we priced"] += 1
            continue
        if not legacy:
            skipped["no bid on the row"] += 1
            continue
        if not key:
            skipped["no company on the row"] += 1
            continue

        pair = (legacy, key)
        if pair in best and rank(best[pair]) >= rank(row):
            skipped["duplicate row for the same company on the same bid"] += 1
            continue
        if pair in best:
            skipped["duplicate row for the same company on the same bid"] += 1
        best[pair] = row

    wanted = {}
    for (legacy, key), row in best.items():
        amount, field, sent = chosen_price(row)
        status = (row.get("Status") or "").strip()
        status = STATUS_MAP.get(status, status)
        wanted[(legacy, key)] = {
            "company": (row.get("Company Name") or "").strip(),
            "price": amount,
            "price_sent_on": sent,
            "type": "budgetary" if row.get("Type of Price") == "Budget"
                    else "proposal",
            "status": status if status in VALID_STATUS else "Sent",
            "notes": note_for(row, field),
            "_project": (row.get("Project Name") or "").strip(),
        }
    return wanted, skipped, len(rows)


# ---------------------------------------------------------------------------
#  Matching it to what is in the database
# ---------------------------------------------------------------------------

def plan():
    wanted, skipped, total_rows = build_wanted()

    # Ordered because the read is paged: PostgREST applies limit/offset
    # without a sort of its own, so an unordered read of several pages can
    # repeat a row on one page and miss it on the next.
    opps = page_all("/rest/v1/opportunities?select=id,legacy_id,name"
                    "&legacy_id=not.is.null&order=id")
    by_legacy = {str(o["legacy_id"]): o for o in opps}

    quotes = page_all("/rest/v1/pricing_quotes?select=id,opportunity_id,company,"
                      "type,price,price_sent_on,notes,status,created_at"
                      "&order=id")
    by_bid = collections.defaultdict(list)
    for q in quotes:
        by_bid[str(q["opportunity_id"])].append(q)

    updates, inserts, audit = [], [], []
    tally = collections.Counter()
    no_such_bid = set()

    for (legacy, key), want in sorted(wanted.items()):
        bid = by_legacy.get(legacy)
        if not bid:
            tally["affiliation whose bid is not in Battag Bid"] += 1
            no_such_bid.add(legacy)
            continue

        matches = [q for q in by_bid[str(bid["id"])]
                   if company_key(q["company"]) == key]

        if len(matches) > 1:
            tally["skipped: several quotes for one company on the bid"] += 1
            audit.append((bid["name"], want["company"], "ambiguous",
                          "", "", "several quotes for this company"))
            continue

        if not matches:
            inserts.append({
                "opportunity_id": bid["id"],
                "company": want["company"],
                "type": want["type"],
                "price": want["price"],
                "price_sent_on": want["price_sent_on"],
                "notes": want["notes"],
                "status": want["status"],
                "created_at": IMPORT_STAMP,
            })
            tally["new quote the first import missed"] += 1
            audit.append((bid["name"], want["company"], "inserted",
                          "", want["price"] or "", "not in the first import"))
            continue

        quote = matches[0]
        if not str(quote["created_at"]).startswith(IMPORT_DAY):
            tally["left alone: entered by hand after the import"] += 1
            audit.append((bid["name"], want["company"], "left alone",
                          quote["price"] or "", "",
                          f"entered {str(quote['created_at'])[:10]}, not the import"))
            continue

        patch = {k: want[k] for k in
                 ("price", "price_sent_on", "type", "status", "notes")}
        changed = {k: v for k, v in patch.items()
                   if normalise(quote.get(k)) != normalise(v)}
        if not changed:
            tally["already correct"] += 1
            continue

        updates.append({
            "id": quote["id"],
            # opportunity_id, company and type are sent on every row because
            # the upsert is written as an insert that falls through to an
            # update: the row it offers has to satisfy the not-null columns
            # even though the existing row is what actually gets written.
            "opportunity_id": quote["opportunity_id"],
            "company": quote["company"],
            **patch,
        })

        if "price" in changed:
            before, after = quote.get("price"), patch["price"]
            kind = ("price added" if before is None else
                    "price cleared" if after is None else "price corrected")
            tally[kind] += 1
            audit.append((bid["name"], want["company"], kind,
                          "" if before is None else before,
                          "" if after is None else after,
                          ", ".join(sorted(changed))))
        else:
            tally["price already right, other fields fixed"] += 1
            audit.append((bid["name"], want["company"], "details only",
                          quote.get("price") or "", quote.get("price") or "",
                          ", ".join(sorted(changed))))

    named_by_export = {(str(by_legacy[legacy]["id"]), key)
                       for (legacy, key) in wanted if legacy in by_legacy}
    untouched = [q for q in quotes
                 if (str(q["opportunity_id"]), company_key(q["company"]))
                 not in named_by_export]

    return (updates, inserts, audit, tally, skipped, total_rows,
            len(quotes), no_such_bid, untouched)


def normalise(v):
    """Compare what the database holds with what the export says without
    tripping over 276535 vs 276535.0 or '' vs None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return str(v).strip()


# ---------------------------------------------------------------------------
#  Writing
# ---------------------------------------------------------------------------

def check_snapshot():
    """Refuse to touch anything until the before-picture exists."""
    try:
        req = urllib.request.Request(
            f"{URL}/rest/v1/{SNAPSHOT}?select=id&limit=1",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}",
                     "Prefer": "count=exact"})
        with urllib.request.urlopen(req) as r:
            count = int(r.headers.get("content-range", "0-0/0").split("/")[-1])
    except urllib.error.HTTPError:
        count = 0
    if count == 0:
        sys.exit(
            f"\nSTOPPING: the snapshot table {SNAPSHOT} is missing or empty.\n"
            "Run supabase_backup_20261027.sql in the Supabase SQL editor first "
            "— it is the only copy of what the prices look like now.\n")
    print(f"  snapshot {SNAPSHOT}: {count} rows — safe to proceed")
    return count


def write_audit(audit):
    os.makedirs(os.path.dirname(AUDIT_CSV), exist_ok=True)
    with open(AUDIT_CSV, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["bid", "company", "what happened", "price before",
                    "price after", "fields changed"])
        w.writerows(audit)
    print(f"  audit of every change: {AUDIT_CSV}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true",
                    help="report and write the audit CSV, change nothing")
    args = ap.parse_args()

    print(f"reading {AFFILIATIONS_CSV}")
    (updates, inserts, audit, tally, skipped, total_rows, quote_count,
     no_such_bid, untouched) = plan()

    print(f"\n{total_rows} rows in the export")
    for reason, n in skipped.most_common():
        print(f"  {n:6}  skipped: {reason}")
    print(f"\n{quote_count} quotes in the database")
    for what, n in tally.most_common():
        print(f"  {n:6}  {what}")
    print(f"\n{len(untouched)} quotes the export never mentions — left alone")
    print(f"{len(updates)} quotes to update, {len(inserts)} to insert")

    if no_such_bid:
        print(f"\n{len(no_such_bid)} bids are priced in the export but are not "
              "in Battag Bid at all.")
        print("  They were created in the old tracker after the August "
              "opportunities export, so there is nothing here to attach their "
              "prices to. Re-export Opportunities and re-run import_tracker.py "
              "to bring the bids over, then run this again.")
        print(f"  old ids: {', '.join(sorted(no_such_bid, key=int)[:20])}"
              + (" ..." if len(no_such_bid) > 20 else ""))

    write_audit(audit)

    if args.dry_run:
        print("\n--- dry run, nothing written ---")
        for row in updates[:5]:
            print("  would set", json.dumps(
                {k: v for k, v in row.items() if k != "opportunity_id"}))
        return

    print()
    check_snapshot()

    done = 0
    for group in chunk(updates, BATCH):
        call("POST", "/rest/v1/pricing_quotes?on_conflict=id", group,
             prefer="resolution=merge-duplicates,return=minimal")
        done += len(group)
        print(f"  updated {done}/{len(updates)}")
    if inserts:
        for group in chunk(inserts, BATCH):
            call("POST", "/rest/v1/pricing_quotes", group,
                 prefer="return=minimal")
        print(f"  inserted {len(inserts)}")

    print("\ndone.")
    print("Flip the toggle under the filter bar to Snapshot to see the "
          "before-picture, Live for the merged one.")


if __name__ == "__main__":
    main()
