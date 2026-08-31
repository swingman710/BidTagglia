#!/usr/bin/env python3
"""
Import the old bid tracker's exports into the new Supabase project.

    python3 import_tracker.py --dry-run     # parse and report, write nothing
    python3 import_tracker.py               # opportunities, quotes, companies, contacts
    python3 import_tracker.py --only companies

Replaces import_2023.py / import_2023_upload.py, which only handled one year.

Opportunities are keyed by the old system's Record ID# in `legacy_id`, so a
re-run UPDATES what it already imported rather than duplicating it — the point
of a sync rather than a one-off load. Anything edited in Battag Bid on an
imported bid is overwritten by the export; that was the explicit choice.

Mapping decisions, all confirmed:

  status      Not Bid -> No Bid, On Hold -> On Hold (Bid),
              Budget Complete -> Budgeting, Pursuing -> Bidding,
              Opportunity -> Future Opportunity. The rest already match.

  value       Current Value, which is populated on every row (Budgeted Project
              Value is on well under half).

  dates       `Date Created` is the old system's migration date on every row,
              so it is ignored; the bid due date is the only usable date.

  Bid To:     becomes the company on a proposal quote and nothing else. It
              reads like the owner but is the GC/CM that was priced, and
              differs from Owner/Customer on most bids. Several companies are
              separated by ';' — never by ',', which appears inside names
              like "E.P. Guidi, Inc." — and each gets its own quote.

  prices      Only ~111 of 6,537 bids have an amount in the price export. The
              rest get a quote carrying the company with no amount, so the
              Companies tab and Reports' "Company Bid To" work across all of it.

  companies   All 1,384, including the 632 never bid to. Type is multi-value.

  contacts    All 56, including the 32 marked In-Active — they are internal
              staff rather than contacts at customers, which is worth knowing
              when reading that tab.
"""

import argparse
import collections
import csv
import json
import re
import sys
import urllib.error
import urllib.request

URL = "https://syxfuydxpuewhewmfajj.supabase.co"
KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG"
BATCH = 200

SRC = "/Users/tre/Downloads/covs"
OPPS_CSV = f"{SRC}/Opportunitiesrl.csv"
COMPANIES_CSV = f"{SRC}/Companiesrl.csv"
CONTACTS_CSV = f"{SRC}/Contactsrl.csv"
PRICES_CSV = "/Users/tre/Downloads/Proposal_Prices (1).csv"

csv.field_size_limit(sys.maxsize)

STATUS_MAP = {
    "Not Bid": "No Bid",
    "On Hold": "On Hold (Bid)",
    "Budget Complete": "Budgeting",
    "Pursuing": "Bidding",
    "Opportunity": "Future Opportunity",
}


# ---------------------------------------------------------------------------
#  Reading
# ---------------------------------------------------------------------------

def read(path):
    # The exports are not valid UTF-8 (smart quotes in cp1252 byte ranges).
    # Replacing the bad bytes costs a couple of typographic characters inside
    # note text and nothing else.
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


def time_of(v, is_set):
    """The due time, but only where the old system flagged one as set —
    otherwise it stores a meaningless 12:00 AM."""
    if (is_set or "").strip().lower() != "yes":
        return None
    m = re.search(r"(\d{1,2}):(\d{2})\s*([AP]M)", (v or "").upper())
    if not m:
        return None
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3)
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{mi}"


def txt(v):
    s = (v or "").strip()
    return s or None


def unions(raw):
    """'Local 654' -> ['654'];  'Local 313 and 98' -> ['313', '98']."""
    if not raw:
        return []
    return re.findall(r"\d+[\w-]*", raw.replace("Local", " "))


def split_list(raw):
    """Only ';' separates companies. Commas belong to the names themselves —
    "E.P. Guidi, Inc.", "Rectenwald Brothers Construction, Inc." — and
    splitting on them turns one company into two."""
    return [c.strip() for c in (raw or "").split(";") if c.strip()]


def description(row):
    """Description, Bid Notes and Bid Details are three separate fields in the
    old system and many bids fill more than one, so keep all three under
    headings rather than letting two of them vanish."""
    parts = []
    for label, key in (("", "Description"), ("Notes", "Bid Notes"),
                       ("Bid Details", "Bid Details")):
        text = (row.get(key) or "").strip()
        if not text:
            continue
        parts.append(f"{label}:\n{text}" if label else text)
    return "\n\n".join(parts) or None


# ---------------------------------------------------------------------------
#  Supabase
# ---------------------------------------------------------------------------

def call(method, path, body=None, prefer=None):
    headers = {
        "apikey": KEY,
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {path} failed: HTTP {e.code}\n{e.read().decode()[:700]}")


def page_all(path):
    """PostgREST caps a select at 1,000 rows, so read through."""
    out, offset = [], 0
    while True:
        sep = "&" if "?" in path else "?"
        rows = call("GET", f"{path}{sep}limit=1000&offset={offset}")
        if not rows:
            return out
        out.extend(rows)
        offset += 1000


def send(table, rows, label, method="POST", prefer="return=minimal"):
    if not rows:
        print(f"  {label}: nothing to send")
        return
    print(f"  {label}: {len(rows)} rows")
    for i in range(0, len(rows), BATCH):
        call(method, f"/rest/v1/{table}", rows[i:i + BATCH], prefer=prefer)
        print(f"    {min(i + BATCH, len(rows))}/{len(rows)}")


# ---------------------------------------------------------------------------
#  Opportunities + quotes
# ---------------------------------------------------------------------------

def build_opportunities():
    opps = read(OPPS_CSV)
    rows = []
    for r in opps:
        status = (r.get("Current Status") or "").strip()
        rows.append({
            "legacy_id": r["Record ID#"],
            "name": txt(r.get("Opportunity Name")),
            "internal_bid_number": txt(r.get("Internal Bid #")),
            "status": STATUS_MAP.get(status, status) or None,
            "bid_due_date": date(r.get("Bid Due Date")),
            "bid_due_time": time_of(r.get("Bid Due Date"), r.get("Is Time Set")),
            "division": txt(r.get("Division")),
            "lead_estimator": txt(r.get("Lead Estimator")),
            "project_manager": txt(r.get("Project Manager")),
            "owner_customer": txt(r.get("Owner/Customer")),
            "industry": txt(r.get("Industry")),
            "market_segment": txt(r.get("Market Segment")),
            "bid_type": txt(r.get("Bid Type")),
            "delivery_method": txt(r.get("Delivery Method")),
            # "Related GC/CM" is a Record ID pointing at the company already
            # named in CM — a duplicate reference, not a second company.
            "cm": split_list(r.get("CM")),
            "architect": txt(r.get("Architect")),
            "engineer": txt(r.get("Engineer")),
            "local_unions": unions(r.get("Union")) or unions(r.get("Local Union(s)")),
            "description": description(r),
            "project_address": txt(r.get("Project Address: Street 1")),
            "city": txt(r.get("Project Address: City")),
            "state": txt(r.get("Project Address: State/Region")),
            "zip_code": txt(r.get("Project Address: Postal Code")),
            "budgeted_project_value": num(r.get("Current Value")),
            "budgeted_cost": num(r.get("Budgeted Cost")),
            "budgeted_labor_hours": num(r.get("Budgeted Labor Hours")),
            "budgeted_square_footage": num(r.get("Budgeted Square Footage")),
            "est_start_date": date(r.get("Estimated Project Start Date")),
            "est_end_date": date(r.get("Estimated Project End Date")),
            "docs_received_date": date(r.get("Documents Received Date")),
        })
    return opps, rows


def build_quotes(opps):
    prices = read(PRICES_CSV)
    by_opp = collections.defaultdict(list)
    for p in prices:
        rid = (p.get("Related Opportunity") or "").strip()
        if rid and (p.get("Deleted") or "").lower() != "yes":
            if (p.get("Amount") or "").strip():
                by_opp[rid].append(p)

    quotes = []
    for r in opps:
        rid = r["Record ID#"]
        amounts = by_opp.get(rid, [])
        for i, company in enumerate(split_list(r.get("Bid To:"))):
            # Only the first company inherits an amount; the rest record who
            # was bid to rather than inventing a price for them.
            price = amounts[i] if i < len(amounts) else (amounts[0] if i == 0 and amounts else None)
            quotes.append({
                "legacy_id": rid,
                "type": "proposal",
                "company": company,
                "price": num(price.get("Amount")) if price else None,
                "price_sent_on": date(price.get("Sent Date")) if price else None,
                "status": "Sent",
            })
    return quotes


def import_opportunities(dry):
    opps, rows = build_opportunities()
    quotes = build_quotes(opps)
    priced = sum(1 for q in quotes if q["price"] is not None)
    print(f"opportunities: {len(rows)}")
    print(f"quotes:        {len(quotes)} ({priced} with an amount)")
    if dry:
        print("\n--- first opportunity ---")
        print(json.dumps(rows[0], indent=2)[:800])
        return

    # Replace rather than update: refreshing 6,500 rows one PATCH at a time is
    # thousands of round trips, where a delete plus a bulk insert is a few
    # dozen. Only rows carrying a legacy_id are touched, so bids created in the
    # app are left alone.
    print("  clearing previously imported quotes and bids...")
    ids = [r["id"] for r in page_all("/rest/v1/opportunities?select=id"
                                     "&legacy_id=not.is.null")]
    print(f"    {len(ids)} imported bids to replace")
    for group in chunk(ids, 100):
        joined = ",".join(f'"{i}"' for i in group)
        call("DELETE", f"/rest/v1/pricing_quotes?opportunity_id=in.({joined})",
             prefer="return=minimal")
    call("DELETE", "/rest/v1/opportunities?legacy_id=not.is.null",
         prefer="return=minimal")

    send("opportunities", rows, "inserting bids")

    lookup = {r["legacy_id"]: r["id"]
              for r in page_all("/rest/v1/opportunities?select=id,legacy_id"
                                "&legacy_id=not.is.null")}
    print(f"  {len(lookup)} bids carry a legacy id")

    out = []
    for q in quotes:
        oid = lookup.get(q["legacy_id"])
        if not oid:
            continue
        out.append({k: v for k, v in q.items() if k != "legacy_id"}
                   | {"opportunity_id": oid})
    send("pricing_quotes", out, "inserting quotes")


def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# ---------------------------------------------------------------------------
#  Companies
# ---------------------------------------------------------------------------

def import_companies(dry):
    src = read(COMPANIES_CSV)
    rows = []
    seen = set()
    for r in src:
        name = txt(r.get("Name"))
        if not name:
            continue
        key = name.lower().strip()
        if key in seen:      # the export has a few exact duplicates
            continue
        seen.add(key)
        rows.append({
            "name": name,
            "type": split_list(r.get("Type")),
            "industry": txt(r.get("Industry")),
            "phone": txt(r.get("Phone Number")),
            "website": txt(r.get("Website")),
            "notes": txt(r.get("Description")),
        })

    multi = sum(1 for r in rows if len(r["type"]) > 1)
    print(f"companies: {len(rows)} ({multi} with more than one type)")
    if dry:
        print(json.dumps(rows[:3], indent=2))
        return

    # `name` is unique, so anything already there is updated rather than
    # rejected — companies created by pricing a bid keep their row.
    existing = {r["name"].lower().strip(): r["id"]
                for r in page_all("/rest/v1/companies?select=id,name")}
    new = [r for r in rows if r["name"].lower().strip() not in existing]
    upd = [r for r in rows if r["name"].lower().strip() in existing]

    print(f"  {len(new)} new, {len(upd)} already present")
    send("companies", new, "inserting")
    for i, row in enumerate(upd, 1):
        rid = existing[row["name"].lower().strip()]
        body = {k: v for k, v in row.items() if k != "name"}
        # Don't blank a detail already filled in the app with an empty export
        # column — Industry, phone and website are nearly empty in the export.
        body = {k: v for k, v in body.items() if v not in (None, [], "")}
        if body:
            call("PATCH", f"/rest/v1/companies?id=eq.{rid}", body,
                 prefer="return=minimal")
        if i % 200 == 0 or i == len(upd):
            print(f"    updated {i}/{len(upd)}")


# ---------------------------------------------------------------------------
#  Contacts
# ---------------------------------------------------------------------------

def import_contacts(dry):
    src = read(CONTACTS_CSV)
    rows = []
    for r in src:
        name = " ".join(x for x in [txt(r.get("First Name")), txt(r.get("Last Name"))] if x)
        if not name:
            continue
        status = txt(r.get("Status"))
        rows.append({
            "name": name,
            "email": txt(r.get("Email Address")),
            # Office Phone is empty throughout the export; mobile is all there is.
            "phone": txt(r.get("Office Phone")) or txt(r.get("Mobile Phone")),
            "company": txt(r.get("Company")),
            # The old system tracks whether someone still works there, and the
            # contacts table has nowhere else to put it.
            "notes": None if status in (None, "Active") else f"Status in old tracker: {status}",
        })

    inactive = sum(1 for r in rows if r["notes"])
    print(f"contacts: {len(rows)} ({inactive} marked inactive in the old tracker)")
    if dry:
        print(json.dumps(rows[:3], indent=2))
        return

    existing = {(r.get("name") or "").lower().strip()
                for r in page_all("/rest/v1/contacts?select=name")}
    new = [r for r in rows if r["name"].lower().strip() not in existing]
    print(f"  {len(new)} new, {len(rows) - len(new)} already present")
    send("contacts", new, "inserting")


# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", choices=["opportunities", "companies", "contacts"])
    args = ap.parse_args()

    jobs = {
        "opportunities": import_opportunities,
        "companies": import_companies,
        "contacts": import_contacts,
    }
    for name, fn in jobs.items():
        if args.only and args.only != name:
            continue
        print(f"\n=== {name} ===")
        fn(args.dry_run)

    print("\nDone." if not args.dry_run else "\nDry run: nothing written.")


if __name__ == "__main__":
    import urllib.parse  # used by the opportunity update path
    main()
