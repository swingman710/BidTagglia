#!/usr/bin/env python3
"""
Diff a live table against its bk_20261027_ snapshot and write down every row
that differs.

    python3 compare_to_snapshot.py                      # pricing_quotes
    python3 compare_to_snapshot.py --table opportunities

This is the written-down version of what the toggle under the filter bar shows
on screen, and the honest record of what the pricing merge did: it is computed
from the before and the after, not from what a script intended to do.

Run it any time to confirm nothing has drifted — on a table the merge never
touched, every row should still match.
"""

import argparse
import collections
import csv
import json
import os
import sys
import urllib.error
import urllib.request

URL = "https://syxfuydxpuewhewmfajj.supabase.co"
KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG"
PREFIX = "bk_20261027_"
HERE = os.path.dirname(os.path.abspath(__file__))


def page_all(path):
    out = []
    step = 1000
    while True:
        joiner = "&" if "?" in path else "?"
        req = urllib.request.Request(
            f"{URL}{path}{joiner}limit={step}&offset={len(out)}",
            headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"})
        try:
            with urllib.request.urlopen(req) as r:
                got = json.load(r)
        except urllib.error.HTTPError as e:
            sys.exit(f"\nGET {path} failed: {e.code} {e.read().decode()[:300]}")
        out += got
        if len(got) < step:
            return out


def same(a, b):
    """Treat 276535 and 276535.0, and '' and None, as the same value."""
    if a in (None, "") and b in (None, ""):
        return True
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a) == str(b)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default="pricing_quotes")
    args = ap.parse_args()
    table = args.table

    # Ordered: limit/offset without a sort is not a stable window.
    before = {r["id"]: r for r in page_all(f"/rest/v1/{PREFIX}{table}?select=*&order=id")}
    after = {r["id"]: r for r in page_all(f"/rest/v1/{table}?select=*&order=id")}

    # Bid names make the audit readable; without them it is a list of uuids.
    names = {}
    if table == "pricing_quotes":
        names = {o["id"]: o["name"] for o in
                 page_all("/rest/v1/opportunities?select=id,name&order=id")}

    added = [i for i in after if i not in before]
    removed = [i for i in before if i not in after]
    fields = sorted(set(next(iter(before.values())).keys()) - {"id"}) if before else []

    rows = []
    tally = collections.Counter()
    for i, old in before.items():
        new = after.get(i)
        if new is None:
            tally["row deleted"] += 1
            rows.append([names.get(old.get("opportunity_id"), ""),
                         old.get("company", ""), "row deleted", "", "", ""])
            continue
        changed = [f for f in fields if not same(old.get(f), new.get(f))]
        if not changed:
            continue
        if "price" in changed:
            o, n = old.get("price"), new.get("price")
            what = ("price added" if o is None else
                    "price cleared" if n is None else "price corrected")
        else:
            what = "details only"
        tally[what] += 1
        rows.append([names.get(old.get("opportunity_id"), ""),
                     old.get("company", ""), what,
                     "" if old.get("price") is None else old["price"],
                     "" if new.get("price") is None else new["price"],
                     ", ".join(changed)])

    for i in added:
        new = after[i]
        tally["row added"] += 1
        rows.append([names.get(new.get("opportunity_id"), ""),
                     new.get("company", ""), "row added", "",
                     "" if new.get("price") is None else new["price"], ""])

    out = os.path.join(HERE, f"{table}_vs_snapshot_20261027.csv")
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["bid", "company", "what changed", "price before",
                    "price after", "fields that differ"])
        w.writerows(sorted(rows, key=lambda r: (r[2], str(r[0]))))

    print(f"{table}")
    print(f"  snapshot: {len(before)} rows")
    print(f"  live now: {len(after)} rows")
    if not rows:
        print("\n  identical — nothing has changed since the snapshot.")
    else:
        print()
        for what, n in tally.most_common():
            print(f"  {n:6}  {what}")
        print(f"\n  {len(rows)} rows differ: {out}")


if __name__ == "__main__":
    main()
