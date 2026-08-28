#!/usr/bin/env python3
"""
Turn the old bid tracker's CSV exports into SQL for the new database.

    python3 import_2023.py > import_2023.sql

Then paste import_2023.sql into the Supabase SQL Editor.

Scope: bids whose BID DUE DATE falls in the chosen year (2023 by default).
`Date Created` in the export is 04-25-2025 on every row — the day the old
system was migrated, not when the bid was raised — so it can't be used for
anything and is ignored.

Mapping decisions, all confirmed:

  status        Not Bid -> No Bid, On Hold -> On Hold (Bid),
                Budget Complete -> Budgeting, Pursuing -> Bidding,
                Opportunity -> Future Opportunity. The rest already match.

  value         Current Value, which is populated on every row (Budgeted
                Project Value is only on ~47% and would leave the rest at $0).

  description   Description + Bid Notes + Bid Details concatenated, each under
                its own heading, since 135 bids carry more than one of them.

  unions        "Local 654" -> 654. "Local 313 and 98" -> both.

  Bid To:       becomes the company on a Proposal quote, and ONLY that — it is
                the GC/CM that was priced, which differs from Owner/Customer on
                58% of bids, so it must not overwrite the owner. Semicolons and
                commas separate several companies; each becomes its own quote.

  prices        Every bid gets a quote per company named in Bid To:, carrying an
                amount only where the price export has one (111 of 1,363 for
                2023). A quote with no amount still records who was bid to.
                Old types 'initial' and 'revision' both import as Proposal.
"""

import csv
import re
import sys
import collections

YEAR = "2023"
OPPS_CSV = "/Users/tre/Downloads/Opportunities (1).csv"
PRICES_CSV = "/Users/tre/Downloads/Proposal_Prices (1).csv"

csv.field_size_limit(sys.maxsize)

STATUS_MAP = {
    "Not Bid": "No Bid",
    "On Hold": "On Hold (Bid)",
    "Budget Complete": "Budgeting",
    "Pursuing": "Bidding",
    "Opportunity": "Future Opportunity",
    # Already valid in the app: Won, Lost, Cancelled, Pending.
}


def read(path):
    # The export is not valid UTF-8 (smart quotes in cp1252 byte ranges).
    # Replacing the bad bytes loses a couple of typographic characters inside
    # note text and nothing else.
    return list(csv.DictReader(open(path, encoding="utf-8", errors="replace")))


def q(v):
    """A SQL literal for a text value; empty becomes null."""
    if v is None:
        return "null"
    s = str(v).strip()
    if not s:
        return "null"
    return "'" + s.replace("'", "''") + "'"


def num(v):
    """'$70,000,000' -> 70000000. Blank or unparseable -> null."""
    s = re.sub(r"[^0-9.\-]", "", (v or ""))
    if not s or s in {"-", "."}:
        return "null"
    try:
        f = float(s)
    except ValueError:
        return "null"
    return repr(int(f)) if f == int(f) else repr(f)


def date(v):
    """'09-07-2023 02:00 PM' -> '2023-09-07'. Blank -> null."""
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", (v or "").strip())
    return f"'{m.group(3)}-{m.group(1)}-{m.group(2)}'" if m else "null"


def time_of(v, is_set):
    """The due time, but only when the old system flagged one as set —
    otherwise it stores a meaningless 12:00 AM."""
    if (is_set or "").strip().lower() != "yes":
        return "null"
    m = re.search(r"(\d{1,2}):(\d{2})\s*([AP]M)", (v or "").upper())
    if not m:
        return "null"
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3)
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"'{h:02d}:{mi}'"


def arr(values):
    """A Postgres text[] literal."""
    clean = [str(v).strip() for v in values if str(v).strip()]
    if not clean:
        return "'{}'"
    inner = ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in clean)
    return "'{" + inner.replace("'", "''") + "}'"


def unions(raw):
    """'Local 654' -> ['654'];  'Local 313 and 98' -> ['313', '98']."""
    if not raw:
        return []
    return re.findall(r"\d+[\w-]*", raw.replace("Local", " "))


def companies(raw):
    """Bid To: may name several companies, separated by ; or ,"""
    return [c.strip() for c in re.split(r"[;,]", raw or "") if c.strip()]


def description(row):
    """Description, Bid Notes and Bid Details are three separate fields in the
    old system and 135 bids fill more than one, so keep all three under
    headings rather than letting two of them vanish."""
    parts = []
    for label, key in (("", "Description"), ("Notes", "Bid Notes"),
                       ("Bid Details", "Bid Details")):
        text = (row.get(key) or "").strip()
        if not text:
            continue
        parts.append(f"{label}:\n{text}" if label else text)
    return "\n\n".join(parts)


def main():
    opps = read(OPPS_CSV)
    prices = read(PRICES_CSV)

    def year_of(row):
        m = re.match(r"\d{2}-\d{2}-(\d{4})", (row.get("Bid Due Date") or "").strip())
        return m.group(1) if m else None

    picked = [r for r in opps if year_of(r) == YEAR]

    # Prices hang off the opportunity's Record ID#.
    by_opp = collections.defaultdict(list)
    for p in prices:
        rid = (p.get("Related Opportunity") or "").strip()
        if rid and (p.get("Deleted") or "").lower() != "yes":
            by_opp[rid].append(p)

    out = []
    w = out.append

    w("-- ==========================================================================")
    w(f"--  Bids due in {YEAR}, imported from the old tracker.")
    w("--")
    w("--  Generated by import_2023.py. Run ONCE — re-running duplicates every row.")
    w("--  To undo: delete from public.pricing_quotes where opportunity_id in")
    w("--    (select id::text from public.opportunities where legacy_id is not null);")
    w("--    delete from public.opportunities where legacy_id is not null;")
    w("-- ==========================================================================")
    w("")
    w("-- The old system's Record ID#, kept so an import can be traced or undone,")
    w("-- and so a re-run can tell which bids it already brought across.")
    w("alter table public.opportunities")
    w("  add column if not exists legacy_id text;")
    w("create unique index if not exists opportunities_legacy_idx")
    w("  on public.opportunities(legacy_id) where legacy_id is not null;")
    w("")

    stats = collections.Counter()
    quote_rows = []

    for r in picked:
        rid = r["Record ID#"]
        stats["bids"] += 1

        # One quote per company bid to, priced where the export has an amount.
        amounts = [p for p in by_opp.get(rid, []) if (p.get("Amount") or "").strip()]
        for i, comp in enumerate(companies(r.get("Bid To:"))):
            price = amounts[i] if i < len(amounts) else (amounts[0] if amounts else None)
            # Only the first company inherits the amount; the rest record who
            # was bid to without inventing a price for them.
            if i > 0 and len(amounts) <= 1:
                price = None
            quote_rows.append((rid, comp,
                               num(price.get("Amount")) if price else "null",
                               date(price.get("Sent Date")) if price else "null"))
            stats["quotes"] += 1
            if price:
                stats["quotes with an amount"] += 1

        status = r.get("Current Status", "").strip()
        cols = [
            ("legacy_id", q(rid)),
            ("name", q(r.get("Opportunity Name"))),
            ("internal_bid_number", q(r.get("Internal Bid #"))),
            ("status", q(STATUS_MAP.get(status, status))),
            ("bid_due_date", date(r.get("Bid Due Date"))),
            ("bid_due_time", time_of(r.get("Bid Due Date"), r.get("Is Time Set"))),
            ("division", q(r.get("Division"))),
            ("lead_estimator", q(r.get("Lead Estimator"))),
            ("project_manager", q(r.get("Project Manager"))),
            ("owner_customer", q(r.get("Owner/Customer"))),
            ("industry", q(r.get("Industry"))),
            ("local_unions", arr(unions(r.get("Union")))),
            ("description", q(description(r))),
            ("project_address", q(r.get("Project Address: Street 1"))),
            ("city", q(r.get("Project Address: City"))),
            ("state", q(r.get("Project Address: State/Region"))),
            ("zip_code", q(r.get("Project Address: Postal Code"))),
            ("budgeted_project_value", num(r.get("Current Value"))),
            ("budgeted_cost", num(r.get("Budgeted Cost"))),
            ("budgeted_labor_hours", num(r.get("Budgeted Labor Hours"))),
            ("budgeted_square_footage", num(r.get("Budgeted Square Footage"))),
            ("est_start_date", date(r.get("Estimated Project Start Date"))),
            ("est_end_date", date(r.get("Estimated Project End Date"))),
        ]
        names = ", ".join(c for c, _ in cols)
        vals = ", ".join(v for _, v in cols)
        w(f"insert into public.opportunities ({names})\n  values ({vals})"
          f"\n  on conflict (legacy_id) do nothing;")

    w("")
    w("-- Quotes. opportunity_id is looked up by legacy_id so the bids keep the")
    w("-- uuids the database generated for them.")
    for rid, comp, amount, sent in quote_rows:
        w("insert into public.pricing_quotes "
          "(opportunity_id, type, company, price, price_sent_on, status)")
        w(f"  select id::text, 'proposal', {q(comp)}, {amount}, {sent}, 'Sent'")
        w(f"  from public.opportunities where legacy_id = {q(rid)};")

    w("")
    w("select")
    w("  (select count(*) from public.opportunities where legacy_id is not null)"
      " as imported_bids,")
    w("  (select count(*) from public.pricing_quotes) as quotes;")

    sys.stdout.write("\n".join(out) + "\n")
    for k, v in stats.items():
        print(f"-- {k}: {v}", file=sys.stderr)


if __name__ == "__main__":
    main()
