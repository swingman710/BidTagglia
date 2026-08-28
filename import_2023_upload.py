#!/usr/bin/env python3
"""
Load the old tracker's bids into the new Supabase project over the REST API.

    python3 import_2023_upload.py --dry-run    # parse and report, write nothing
    python3 import_2023_upload.py              # actually insert

Why not SQL: the generated file is 1.2 MB and pasting that into the browser
SQL editor is a good way to get a truncated statement and a confusing error.
PostgREST takes it in batches instead, and reports exactly what it wrote.

Requires the legacy_id column (see the ALTER at the top of import_2023.py's
output). legacy_id is the old system's Record ID#: it makes the import
traceable, lets a re-run skip what it already inserted, and makes the whole
thing undoable.

The field mapping lives in import_2023.py — this module imports it rather than
restating it, so the two can't drift apart.
"""

import argparse
import json
import sys
import urllib.error
import urllib.request

import import_2023 as M

URL = "https://syxfuydxpuewhewmfajj.supabase.co"
KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG"
BATCH = 200


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
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = r.read()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        sys.exit(f"\n{method} {path} failed: HTTP {e.code}\n{e.read().decode()[:600]}")


def unquote(v):
    """import_2023 emits SQL literals; unwrap them back to Python values."""
    if v == "null":
        return None
    if v.startswith("'") and v.endswith("'"):
        return v[1:-1].replace("''", "'")
    if v == "'{}'":
        return []
    try:
        return int(v)
    except ValueError:
        try:
            return float(v)
        except ValueError:
            return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--year", default=M.YEAR)
    args = ap.parse_args()

    opps = M.read(M.OPPS_CSV)
    prices = M.read(M.PRICES_CSV)

    import re
    import collections

    def year_of(row):
        m = re.match(r"\d{2}-\d{2}-(\d{4})", (row.get("Bid Due Date") or "").strip())
        return m.group(1) if m else None

    picked = [r for r in opps if year_of(r) == args.year]

    by_opp = collections.defaultdict(list)
    for p in prices:
        rid = (p.get("Related Opportunity") or "").strip()
        if rid and (p.get("Deleted") or "").lower() != "yes":
            by_opp[rid].append(p)

    # ---- Build the rows ----------------------------------------------------
    bids, quotes = [], []
    for r in picked:
        rid = r["Record ID#"]
        status = (r.get("Current Status") or "").strip()
        bids.append({
            "legacy_id": rid,
            "name": unquote(M.q(r.get("Opportunity Name"))),
            "internal_bid_number": unquote(M.q(r.get("Internal Bid #"))),
            "status": M.STATUS_MAP.get(status, status) or None,
            "bid_due_date": unquote(M.date(r.get("Bid Due Date"))),
            "bid_due_time": unquote(M.time_of(r.get("Bid Due Date"), r.get("Is Time Set"))),
            "division": unquote(M.q(r.get("Division"))),
            "lead_estimator": unquote(M.q(r.get("Lead Estimator"))),
            "project_manager": unquote(M.q(r.get("Project Manager"))),
            "owner_customer": unquote(M.q(r.get("Owner/Customer"))),
            "industry": unquote(M.q(r.get("Industry"))),
            "local_unions": M.unions(r.get("Union")),
            "description": unquote(M.q(M.description(r))),
            "project_address": unquote(M.q(r.get("Project Address: Street 1"))),
            "city": unquote(M.q(r.get("Project Address: City"))),
            "state": unquote(M.q(r.get("Project Address: State/Region"))),
            "zip_code": unquote(M.q(r.get("Project Address: Postal Code"))),
            "budgeted_project_value": unquote(M.num(r.get("Current Value"))),
            "budgeted_cost": unquote(M.num(r.get("Budgeted Cost"))),
            "budgeted_labor_hours": unquote(M.num(r.get("Budgeted Labor Hours"))),
            "budgeted_square_footage": unquote(M.num(r.get("Budgeted Square Footage"))),
            "est_start_date": unquote(M.date(r.get("Estimated Project Start Date"))),
            "est_end_date": unquote(M.date(r.get("Estimated Project End Date"))),
        })

        amounts = [p for p in by_opp.get(rid, []) if (p.get("Amount") or "").strip()]
        for i, comp in enumerate(M.companies(r.get("Bid To:"))):
            price = amounts[i] if i < len(amounts) else None
            if i == 0 and not price and amounts:
                price = amounts[0]
            quotes.append({
                "legacy_id": rid,
                "type": "proposal",
                "company": comp,
                "price": unquote(M.num(price.get("Amount"))) if price else None,
                "price_sent_on": unquote(M.date(price.get("Sent Date"))) if price else None,
                "status": "Sent",
            })

    priced = sum(1 for q in quotes if q["price"] is not None)
    print(f"{args.year}: {len(bids)} bids, {len(quotes)} quotes "
          f"({priced} with an amount, {len(quotes) - priced} recording the company only)")

    if args.dry_run:
        print("\n--- first bid ---")
        print(json.dumps(bids[0], indent=2)[:900])
        print("\n--- first 3 quotes ---")
        print(json.dumps(quotes[:3], indent=2))
        print("\nDry run: nothing written.")
        return

    # ---- Insert bids -------------------------------------------------------
    # on_conflict=legacy_id makes a re-run skip what is already there rather
    # than duplicating it.
    print(f"\nInserting bids in batches of {BATCH}...")
    for i in range(0, len(bids), BATCH):
        chunk = bids[i:i + BATCH]
        call("POST", "/rest/v1/opportunities?on_conflict=legacy_id", chunk,
             prefer="resolution=ignore-duplicates,return=minimal")
        print(f"  {min(i + BATCH, len(bids))}/{len(bids)}")

    # ---- Map legacy_id -> the uuid the database assigned --------------------
    print("Reading back ids...")
    id_map = {}
    page = 0
    while True:
        rows = call("GET", f"/rest/v1/opportunities?select=id,legacy_id"
                           f"&legacy_id=not.is.null&limit=1000&offset={page * 1000}")
        if not rows:
            break
        id_map.update({r["legacy_id"]: r["id"] for r in rows})
        page += 1
    print(f"  {len(id_map)} bids carry a legacy id")

    # ---- Insert quotes -----------------------------------------------------
    rows = []
    for q in quotes:
        oid = id_map.get(q["legacy_id"])
        if not oid:
            continue
        rows.append({k: v for k, v in q.items() if k != "legacy_id"} | {"opportunity_id": oid})

    print(f"Inserting {len(rows)} quotes...")
    for i in range(0, len(rows), BATCH):
        call("POST", "/rest/v1/pricing_quotes", rows[i:i + BATCH],
             prefer="return=minimal")
        print(f"  {min(i + BATCH, len(rows))}/{len(rows)}")

    print("\nDone.")


if __name__ == "__main__":
    main()
