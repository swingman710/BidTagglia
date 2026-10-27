#!/usr/bin/env python3
"""
Put a table back the way battag_backup_20261027.json found it.

    python3 restore_from_backup.py --list
    python3 restore_from_backup.py --table pricing_quotes --dry-run
    python3 restore_from_backup.py --table pricing_quotes --yes

This is the escape hatch for the 27 Oct 2026 pricing merge. The merge only
rewrites columns on pricing_quotes (and inserts six rows), so in practice
`--table pricing_quotes` is the one to reach for.

It is a REPLACE, not a merge: every row in the live table is deleted and the
backup's rows are inserted with their original ids. Anything added to that
table after the backup was taken is gone afterwards — including quotes typed
into Battag Bid in the meantime. Run it with --dry-run first; it says how many
rows it would delete and whether any of them are newer than the backup.

The in-database snapshot (bk_20261027_*) is a second, independent copy of the
same moment. This script does not touch it, and it stays there to restore
from if this file is ever lost.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

URL = "https://syxfuydxpuewhewmfajj.supabase.co"
KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG"
BACKUP = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "battag_backup_20261027.json")
BATCH = 200


def call(method, path, body=None, prefer=None):
    headers = {"apikey": KEY, "Authorization": f"Bearer {KEY}",
               "Content-Type": "application/json"}
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--table")
    ap.add_argument("--list", action="store_true",
                    help="what the backup holds, and write nothing")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true",
                    help="required to actually replace the table")
    args = ap.parse_args()

    if not os.path.exists(BACKUP):
        sys.exit(f"backup not found: {BACKUP}")
    backup = json.load(open(BACKUP))
    tables = backup["tables"]

    print(f"backup taken {backup['taken_at']}")
    if args.list or not args.table:
        print("\ntables in it:")
        for name, rows in sorted(tables.items()):
            print(f"  {name:18} {len(rows):6} rows in the backup")
        if not args.table:
            print("\nname one with --table to restore it.")
        return

    if args.table not in tables:
        sys.exit(f"'{args.table}' is not in the backup: "
                 f"{', '.join(sorted(tables))}")

    rows = tables[args.table]
    live = page_all(f"/rest/v1/{args.table}?select=*&order=id")
    taken = backup["taken_at"][:19]
    newer = [r for r in live
             if str(r.get("created_at") or "") > taken]

    print(f"\n{args.table}")
    print(f"  live now:      {len(live)} rows")
    print(f"  in the backup: {len(rows)} rows")
    if newer:
        print(f"\n  WARNING: {len(newer)} live rows were created after the "
              "backup was taken.")
        print("  Restoring deletes them. They are not in the backup, so this "
              "is the only")
        print("  notice you get:")
        for r in newer[:10]:
            bits = {k: v for k, v in r.items()
                    if k in ("id", "company", "price", "name", "created_at")}
            print(f"    {bits}")
        if len(newer) > 10:
            print(f"    ... and {len(newer) - 10} more")

    if args.dry_run or not args.yes:
        print("\nnothing written. Re-run with --yes to replace the table "
              "with the backup's rows.")
        return

    print(f"\n  deleting {len(live)} live rows...")
    # `not.is.null` on the primary key matches every row; PostgREST refuses an
    # unfiltered delete on purpose.
    call("DELETE", f"/rest/v1/{args.table}?id=not.is.null",
         prefer="return=minimal")
    done = 0
    for group in chunk(rows, BATCH):
        call("POST", f"/rest/v1/{args.table}", group, prefer="return=minimal")
        done += len(group)
        print(f"  restored {done}/{len(rows)}")
    print(f"\ndone — {args.table} holds the backup's {len(rows)} rows again.")


if __name__ == "__main__":
    main()
