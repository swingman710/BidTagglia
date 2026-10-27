// ===========================================================================
//  Supabase client + config.
//
//  The publishable key is meant to live in client code — what it can actually
//  do is decided by each table's Row Level Security policy. Do NOT put the
//  secret / service_role key here.
//
//  NOTE: the RLS policies currently grant this key full read AND write on
//  every table, which also lets anyone holding it add themselves to
//  app_members and sign in. Tightening that is outstanding work.
// ===========================================================================

const SUPABASE_URL = "https://syxfuydxpuewhewmfajj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Id5Tt9PSvhneLXK71-nDOA_DiRn2mBG";
const SUPABASE_TABLE = "opportunities";

// Created from the UMD global provided by the @supabase/supabase-js CDN script.
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===========================================================================
//  Snapshot mode
//
//  On 2026-10-27 the old tracker's pricing export was merged into
//  pricing_quotes, which rewrote the price on a few thousand quotes. Before
//  that ran, supabase_backup_20261027.sql copied every table to a
//  `bk_20261027_` twin.
//
//  The Live / Snapshot toggle under the filter bar switches the dashboard's
//  reads to those copies, so the merged numbers can be checked against what
//  was there before. Snapshot mode is READ-ONLY, in three layers:
//
//    1. the copies have a select policy and no other, so the key the app
//       holds physically cannot write to them,
//    2. every write here is refused while the toggle is on, including writes
//       to tables that were not snapshotted — a comparison should not be able
//       to change anything at all,
//    3. the dashboard says so on screen.
//
//  The choice lives in sessionStorage, so it survives the reload that
//  switching triggers but is gone for a new tab — nobody should be able to
//  find the app stuck in the past tomorrow morning.
// ===========================================================================

const SNAPSHOT_PREFIX = "bk_20261027_";
const SNAPSHOT_LABEL = "27 Oct 2026, before the pricing merge";

// Only these were swapped. The rest of the snapshot exists as a backup but
// reads straight through to the live table, which the merge never touched.
const SNAPSHOT_TABLES = ["opportunities", "pricing_quotes", "project_members"];

const SNAPSHOT_KEY = "battag_snapshot";

function snapshotOn() {
  return sessionStorage.getItem(SNAPSHOT_KEY) === "1";
}

function setSnapshot(on) {
  if (on) sessionStorage.setItem(SNAPSHOT_KEY, "1");
  else sessionStorage.removeItem(SNAPSHOT_KEY);
  // Every cache on the page — bids, quotes, companies, the report tables — was
  // built from the other database. Reloading rebuilds all of them from the
  // right one, which is the only way to be sure none is left behind.
  location.reload();
}

const SNAPSHOT_REFUSAL =
  "Battag Bid is showing the snapshot from " + SNAPSHOT_LABEL +
  ", which is read-only. Switch the toggle under the filter bar back to Live " +
  "to make changes.";

// Stands in for a query builder on a write that is not allowed. It has to be
// both chainable and awaitable, because the call sites are written as
// `await sb.from(t).insert(row).select()` — so every property answers with
// itself, and awaiting it yields the same { data, error } shape Supabase
// returns. The existing error handling then reports it like any other failure.
function snapshotRefusal() {
  const result = { data: null, error: { message: SNAPSHOT_REFUSAL } };
  const stub = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve, reject) =>
            Promise.resolve(result).then(resolve, reject);
        }
        if (typeof prop === "symbol") return undefined;
        return () => stub;
      },
    }
  );
  return stub;
}

// sb.from() is the single door every table read and write in the app goes
// through, so wrapping it here covers all of them rather than asking each
// call site to remember.
const liveFrom = sb.from.bind(sb);

sb.from = function from(table) {
  if (!snapshotOn()) return liveFrom(table);

  const builder = liveFrom(
    SNAPSHOT_TABLES.includes(table) ? SNAPSHOT_PREFIX + table : table
  );
  // Shadows the prototype's methods on this instance only.
  for (const method of ["insert", "update", "upsert", "delete"]) {
    builder[method] = snapshotRefusal;
  }
  return builder;
};
