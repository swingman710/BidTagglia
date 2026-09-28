-- ============================================================================
--  BidTagglia — merge duplicate spellings of three estimators.
--
--  RUN ONCE in the Supabase SQL Editor. Paste it whole and press Run.
--
--    Will Shahan          <- Will Shahan, William Shahan, Shahan William
--    Steve Navert         <- Steve Navert, Navert Steve, Navert
--    David Della Vecchia  <- David Della Vecchia, David Dellavecchia
--
--  Each group also carries the surname-first spelling of the same name, since
--  two of the three turned up that way in the imported data and the third
--  plausibly could.
--
--  It rewrites the bids first (lead estimator AND project manager, since the
--  same people appear in both), then collapses the duplicate rows on the Users
--  tab. Doing the bids first matters: the Users tab rebuilds itself from the
--  names on the bids, so merging the rows while the old spellings were still
--  on the bids would simply re-create them.
--
--  Names are matched on letters only, lower-cased — "Shahan, William",
--  "shahan  william" and "Shahan William" are all the same string by the time
--  they are compared, so odd spacing and stray commas in the imported data are
--  caught without having to list every variation.
--
--  Real sign-in accounts are never deleted: only rows that came from the bid
--  history (source = 'estimator') are ever removed. If one of these people has
--  a real account, that is the row that survives and it just gets the tidy
--  name.
--
--  Safe to re-run. Running it twice changes nothing the second time.
--
--  The three groups are repeated in each statement rather than put in a temp
--  table, so it does not matter whether the SQL editor runs the script as one
--  transaction or as separate statements.
-- ============================================================================


-- ---------------------------------------------------------------------------
--  1. The bids — lead estimator.
-- ---------------------------------------------------------------------------

with m (keep, variants) as (
  values
    ('Will Shahan',         array['willshahan', 'williamshahan',
                                  'shahanwilliam', 'shahanwill']),
    ('Steve Navert',        array['stevenavert', 'navertsteve', 'navert']),
    ('David Della Vecchia', array['daviddellavecchia', 'dellavecchiadavid'])
)
update public.opportunities o
set lead_estimator = m.keep
from m
where regexp_replace(lower(coalesce(o.lead_estimator, '')), '[^a-z]', '', 'g')
      = any (m.variants)
  and o.lead_estimator is distinct from m.keep;


-- ---------------------------------------------------------------------------
--  2. The bids — project manager.
-- ---------------------------------------------------------------------------

with m (keep, variants) as (
  values
    ('Will Shahan',         array['willshahan', 'williamshahan',
                                  'shahanwilliam', 'shahanwill']),
    ('Steve Navert',        array['stevenavert', 'navertsteve', 'navert']),
    ('David Della Vecchia', array['daviddellavecchia', 'dellavecchiadavid'])
)
update public.opportunities o
set project_manager = m.keep
from m
where regexp_replace(lower(coalesce(o.project_manager, '')), '[^a-z]', '', 'g')
      = any (m.variants)
  and o.project_manager is distinct from m.keep;


-- ---------------------------------------------------------------------------
--  3. The Users tab — give every matching row the tidy name.
--
--  If any of the rows being merged was ticked off the dashboard graphs, the
--  merged one stays off them. A tidy-up should not quietly put a former
--  employee back on the charts.
-- ---------------------------------------------------------------------------

with m (keep, variants) as (
  values
    ('Will Shahan',         array['willshahan', 'williamshahan',
                                  'shahanwilliam', 'shahanwill']),
    ('Steve Navert',        array['stevenavert', 'navertsteve', 'navert']),
    ('David Della Vecchia', array['daviddellavecchia', 'dellavecchiadavid'])
)
update public.app_members a
set name = m.keep,
    hidden_from_charts = a.hidden_from_charts or exists (
      select 1 from public.app_members b
      where regexp_replace(lower(coalesce(b.name, '')), '[^a-z]', '', 'g')
            = any (m.variants)
        and b.hidden_from_charts
    )
from m
where regexp_replace(lower(coalesce(a.name, '')), '[^a-z]', '', 'g')
      = any (m.variants);


-- ---------------------------------------------------------------------------
--  4. The Users tab — drop the duplicates that just created.
--
--  A row goes only if it came from the bid history AND something else is
--  keeping the name alive: a real account, or an older bid-history row.
-- ---------------------------------------------------------------------------

delete from public.app_members a
using public.app_members b
where a.name = b.name
  and a.id <> b.id
  and a.source = 'estimator'
  and a.name in ('Will Shahan', 'Steve Navert', 'David Della Vecchia')
  and (b.source <> 'estimator' or b.id < a.id);


-- ---------------------------------------------------------------------------
--  5. The survivor's identity still spells the old name.
--
--  Only bid-history rows carry a name in there at all; a real account's
--  identity is their email address and is left alone.
-- ---------------------------------------------------------------------------

update public.app_members a
set identity = 'estimator:' || lower(a.name)
where a.name in ('Will Shahan', 'Steve Navert', 'David Della Vecchia')
  and a.source = 'estimator'
  and a.identity is distinct from 'estimator:' || lower(a.name);


-- ---------------------------------------------------------------------------
--  What changed.
--
--  Expect user_rows = 1 for each name and stragglers = 0 on both columns.
-- ---------------------------------------------------------------------------

with m (keep, variants) as (
  values
    ('Will Shahan',         array['willshahan', 'williamshahan',
                                  'shahanwilliam', 'shahanwill']),
    ('Steve Navert',        array['stevenavert', 'navertsteve', 'navert']),
    ('David Della Vecchia', array['daviddellavecchia', 'dellavecchiadavid'])
)
select
  m.keep as name,
  (select count(*) from public.app_members a
    where a.name = m.keep)                                  as user_rows,
  (select count(*) from public.opportunities o
    where o.lead_estimator = m.keep)                        as bids_as_estimator,
  (select count(*) from public.opportunities o
    where o.project_manager = m.keep)                       as bids_as_pm,
  (select count(*) from public.opportunities o
    where regexp_replace(lower(coalesce(o.lead_estimator, '')), '[^a-z]', '', 'g')
          = any (m.variants)
      and o.lead_estimator <> m.keep)                       as estimator_stragglers,
  (select count(*) from public.opportunities o
    where regexp_replace(lower(coalesce(o.project_manager, '')), '[^a-z]', '', 'g')
          = any (m.variants)
      and o.project_manager <> m.keep)                      as pm_stragglers
from m
order by m.keep;
