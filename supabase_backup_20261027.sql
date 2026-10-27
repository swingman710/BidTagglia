-- ============================================================================
--  BidTagglia — snapshot of the whole database, taken 2026-10-27, BEFORE the
--  old tracker's pricing export is merged in.
--
--  RUN THIS FIRST, before merge_affiliation_prices.py. The merge script checks
--  that these tables exist and refuses to write anything until they do.
--
--  It copies every table to a `bk_20261027_` twin and makes the copies
--  READ-ONLY at the database level (select policy only, no insert/update/
--  delete), so neither the app nor a stray script can write into the snapshot.
--
--  The Live/Snapshot toggle under the filter bar on the dashboard reads these
--  tables, which is how the merged data can be compared against what was here
--  before it.
--
--  SAFE TO RE-RUN — and re-running does NOT re-take the snapshot. `create
--  table if not exists ... as select` leaves an existing copy alone, which is
--  the point: once the merge has run, a second run of this file must not
--  quietly overwrite the before-picture with the after-picture.
--
--  To take a fresh snapshot later, use a new date in the prefix (and point
--  SNAPSHOT_PREFIX in supabase.js at it) rather than dropping these.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. The copies.
--
--  `as select *` copies the rows and column types but no constraints, indexes
--  or defaults. That is what we want: this is a photograph, not a working
--  table, and nothing is ever inserted into it.
-- ---------------------------------------------------------------------------

create table if not exists public.bk_20261027_opportunities   as select * from public.opportunities;
create table if not exists public.bk_20261027_pricing_quotes  as select * from public.pricing_quotes;
create table if not exists public.bk_20261027_project_members  as select * from public.project_members;
create table if not exists public.bk_20261027_companies        as select * from public.companies;
create table if not exists public.bk_20261027_contacts         as select * from public.contacts;
create table if not exists public.bk_20261027_app_members      as select * from public.app_members;
create table if not exists public.bk_20261027_activities       as select * from public.activities;


-- ---------------------------------------------------------------------------
--  2. Read-only, enforced by the database.
--
--  The dashboard also refuses to write while the toggle is on Snapshot, but
--  that is a convenience — this is the part that makes it true. A select
--  policy and no others means the key the app holds can read these rows and
--  can not change them.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['opportunities', 'pricing_quotes', 'project_members',
                           'companies', 'contacts', 'app_members', 'activities']
  loop
    execute format('alter table public.bk_20261027_%s enable row level security', t);
    execute format('drop policy if exists "snapshot is read-only" on public.bk_20261027_%s', t);
    execute format('create policy "snapshot is read-only" on public.bk_20261027_%s '
                   'for select to anon, authenticated using (true)', t);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
--  3. Check it.
--
--  Every row should read "same". A row reading "DIFFERENT" means the snapshot
--  was taken at some other time than the live table it is being compared to —
--  expected once the merge has run (pricing_quotes will differ, by design),
--  but a surprise if you are running this for the first time.
-- ---------------------------------------------------------------------------

with pairs as (
  select 'opportunities'   as t, (select count(*) from public.opportunities)   as live, (select count(*) from public.bk_20261027_opportunities)   as snap
  union all select 'pricing_quotes',  (select count(*) from public.pricing_quotes),  (select count(*) from public.bk_20261027_pricing_quotes)
  union all select 'project_members', (select count(*) from public.project_members), (select count(*) from public.bk_20261027_project_members)
  union all select 'companies',       (select count(*) from public.companies),       (select count(*) from public.bk_20261027_companies)
  union all select 'contacts',        (select count(*) from public.contacts),        (select count(*) from public.bk_20261027_contacts)
  union all select 'app_members',     (select count(*) from public.app_members),     (select count(*) from public.bk_20261027_app_members)
  union all select 'activities',      (select count(*) from public.activities),      (select count(*) from public.bk_20261027_activities)
)
select t as table_name, live, snap,
       case when live = snap then 'same' else 'DIFFERENT' end as rows
from pairs order by t;
