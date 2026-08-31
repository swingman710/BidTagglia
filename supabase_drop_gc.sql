-- ============================================================================
--  Drop opportunities.gc — CM and GC are the same thing.
--  Run in Supabase -> SQL Editor AFTER the app has been redeployed.
--
--  Nothing is lost. The old tracker's "Related GC/CM" column held a Record ID
--  pointing at the company already named in CM: on all 353 bids where both
--  were filled, the ID resolved to exactly that same company. The handful of
--  bids that had a GC value and no CM have already had it merged across.
-- ============================================================================

alter table public.opportunities drop column if exists gc;

select count(*) as opportunities from public.opportunities;
